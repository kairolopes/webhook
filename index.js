// -------------------------------------------------------------
// 🚀 Servidor Webhook + Firebase Firestore + Autenticação — VERSÃO 3.2 (AUTO-SYNC)
// -------------------------------------------------------------

const express = require("express");
const admin = require("firebase-admin");
const fs = require("fs");
const os = require("os");
const path = require("path");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// -------------------------------------------------------------
// 🔥 1. INICIALIZAÇÃO
// -------------------------------------------------------------
try {
    const jsonString = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const projectId = process.env.GCLOUD_PROJECT;

    if (!jsonString) throw new Error("GOOGLE_APPLICATION_CREDENTIALS não definida.");
    if (!projectId) throw new Error("GCLOUD_PROJECT não definida.");

    const tempPath = path.join(os.tmpdir(), "firebase_key.json");
    fs.writeFileSync(tempPath, jsonString);

    admin.initializeApp({
        credential: admin.credential.cert(require(tempPath)),
        projectId,
    });

    console.log("🔥 Firebase inicializado.");
} catch (err) {
    console.error("❌ Erro ao iniciar Firebase:", err.message);
    process.exit(1);
}

const db = admin.firestore();
const auth = admin.auth();

// -------------------------------------------------------------
// 🔧 2. FUNÇÃO INTELIGENTE - BUSCA OU CRIA USER NO FIRESTORE
// -------------------------------------------------------------
async function findOrCreateUser(email, telefone = "") {
    const cleanEmail = email.trim().toLowerCase();

    // Primeiro tenta Firestore
    const snapshot = await db
        .collection("users")
        .where("email", "==", cleanEmail)
        .get();

    if (!snapshot.empty) {
        return snapshot.docs[0].id;
    }

    // Se não achou → tenta Auth
    let userRecord;
    try {
        userRecord = await auth.getUserByEmail(cleanEmail);
    } catch {
        throw new Error("Usuário não existe (nem no Auth, nem no Firestore).");
    }

    // Se achou no Auth, cria no Firestore automaticamente
    const uid = userRecord.uid;

    await db.collection("users").doc(uid).set({
        email: cleanEmail,
        telefone: telefone || "",
        criadoEm: new Date()
    });

    console.log("✅ Usuário criado automaticamente no Firestore:", cleanEmail);

    return uid;
}

// -------------------------------------------------------------
// 🧪 3. ROTA TESTE
// -------------------------------------------------------------
app.get("/", (req, res) => {
    res.json({ status: "online", message: "Servidor funcionando." });
});

// -------------------------------------------------------------
// 🧑‍💼 4. CADASTRO
// -------------------------------------------------------------
app.post("/cadastro", async (req, res) => {
    try {
        const { email, password, nome, telefone, cpf } = req.body;

        if (!email || !password || !telefone || !nome) {
            return res.status(400).json({ error: "Campos obrigatórios faltando." });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanPhone = telefone.trim();

        const userRecord = await auth.createUser({
            email: cleanEmail,
            password: password
        });

        await db.collection("users").doc(userRecord.uid).set({
            email: cleanEmail,
            nome,
            telefone: cleanPhone,
            cpf,
            criadoEm: new Date()
        });

        res.json({
            status: "sucesso",
            uid: userRecord.uid
        });

    } catch (err) {
        res.status(500).json({ error: "Erro cadastro", details: err.message });
    }
});

// -------------------------------------------------------------
// 💸 5. LANÇAMENTO (ATUALIZADO COM AUTO-SYNC)
// -------------------------------------------------------------
app.post("/lancamento", async (req, res) => {
    try {
        const {
            email,
            telefone,
            tipo,
            contaId,
            categoriaId,
            subcategoria,
            descricao,
            valor,
            data,
            installments = 1
        } = req.body;

        if (!email || !tipo || !valor || !contaId || !categoriaId || !data) {
            return res.status(400).json({ error: "Campos obrigatórios faltando." });
        }

        const userId = await findOrCreateUser(email, telefone);

        const account = await db
            .collection("users")
            .doc(userId)
            .collection("accounts")
            .doc(contaId)
            .get();

        if (!account.exists) {
            return res.status(404).json({ error: "Conta não encontrada." });
        }

        const accountData = account.data();
        const isCreditCard = accountData.type === "credito" && tipo === "expense";
        const n = parseInt(installments);

        const base = {
            tipo,
            contaId,
            categoriaId,
            subcategoria: subcategoria || "",
            descricao,
            valor: Number(valor),
            data,
            criadoEm: new Date(),
            installments: n
        };

        let lancamentos = [];

        if (isCreditCard && n > 1) {
            const purchaseDate = new Date(data);
            const due = parseInt(accountData.dueDay || 10);
            const close = parseInt(accountData.closingDay || 25);
            const eachValue = base.valor / n;

            for (let i = 0; i < n; i++) {
                let month = purchaseDate.getMonth();
                let year = purchaseDate.getFullYear();

                if (i === 0 && purchaseDate.getDate() > close) month++;
                month += i;

                if (month > 11) {
                    year += Math.floor(month / 12);
                    month = month % 12;
                }

                const finalDate = new Date(year, month, due);

                lancamentos.push({
                    ...base,
                    amount: eachValue,
                    descricao: `${descricao} (${i+1}/${n})`,
                    data: finalDate.toISOString().split("T")[0],
                    isInstallment: true
                });
            }
        } else {
            lancamentos.push(base);
        }

        const batch = db.batch();
        const ref = db.collection("users").doc(userId).collection("transactions");

        lancamentos.forEach(l => batch.set(ref.doc(), l));
        await batch.commit();

        res.json({
            status: "sucesso",
            total: lancamentos.length
        });

    } catch (err) {
        res.status(500).json({ error: "Erro no lançamento", details: err.message });
    }
});

// -------------------------------------------------------------
// 📂 6. LISTAR CONTAS
// -------------------------------------------------------------
app.get("/contas", async (req, res) => {
    try {
        const { email } = req.query;
        const userId = await findOrCreateUser(email);

        const snapshot = await db
            .collection("users")
            .doc(userId)
            .collection("accounts")
            .get();

        const contas = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.json({ status: "sucesso", contas });
    } catch (err) {
        res.status(500).json({ error: "Erro contas", details: err.message });
    }
});

// -------------------------------------------------------------
// 🚀 7. START SERVER
// -------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
