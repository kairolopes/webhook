// -------------------------------------------------------------
// 🚀 Servidor Webhook + Firebase Firestore + Autenticação — Versão Oficial 3.1
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
// 🔥 1. INICIALIZAÇÃO (Railway + Firebase) — LIMPA, ROBUSTA, SEGURA
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
// 🔧 2. FUNÇÃO PARA BUSCAR UID PELO EMAIL (VERSÃO MAIS SEGURA)
// -------------------------------------------------------------
async function findUserIdByEmail(email) {
    const cleanEmail = email.trim().toLowerCase();

    const snapshot = await db
        .collection("users")
        .where("email", "==", cleanEmail)
        .get();

    if (snapshot.empty) {
        throw new Error("Usuário não encontrado.");
    }

    return snapshot.docs[0].id;
}

// -------------------------------------------------------------
// 🧪 3. ROTA DE TESTE
// -------------------------------------------------------------
app.get("/", (req, res) => {
    res.json({ status: "online", message: "Servidor rodando no Railway." });
});

// -------------------------------------------------------------
// 🧑‍💼 4. CADASTRO DE USUÁRIO
// -------------------------------------------------------------
app.post("/cadastro", async (req, res) => {
    try {
        const { email, password, nome, telefone, cpf } = req.body;

        if (!email || !password || !telefone || !nome) {
            return res.status(400).json({ error: "Campos obrigatórios faltando." });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanPhone = telefone.trim();

        if (password.length < 6) {
            return res.status(400).json({ error: "A senha deve ter 6+ caracteres." });
        }

        let userRecord;
        try {
            userRecord = await auth.createUser({
                email: cleanEmail,
                password: password
            });
        } catch (e) {
            if (e.code === "auth/email-already-in-use") {
                return res.status(409).json({ error: "Email já cadastrado." });
            }
            throw e;
        }

        await db.collection("users").doc(userRecord.uid).set({
            email: cleanEmail,
            nome,
            telefone: cleanPhone,
            cpf,
            criadoEm: new Date(),
        });

        res.json({
            status: "sucesso",
            uid: userRecord.uid,
            mensagem: "Usuário criado."
        });

    } catch (err) {
        res.status(500).json({ error: "Erro ao cadastrar.", details: err.message });
    }
});

// -------------------------------------------------------------
// 💸 5. CRIAR LANÇAMENTO
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

        if (!email || !telefone || !tipo || !valor || !contaId || !categoriaId || !data) {
            return res.status(400).json({ error: "Campos obrigatórios faltando." });
        }

        const userId = await findUserIdByEmail(email);

        const account = await db
            .collection("users")
            .doc(userId)
            .collection("accounts")
            .doc(contaId)
            .get();

        if (!account.exists) {
            return res.status(404).json({
                error: "Conta não encontrada.",
            });
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

                if (i === 0 && purchaseDate.getDate() > close) {
                    month++;
                }

                month += i;

                if (month > 11) {
                    year += Math.floor(month / 12);
                    month %= 12;
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
            mensagem: `${lancamentos.length} lançamento(s) registrado(s).`,
            userId
        });

    } catch (err) {
        res.status(500).json({
            error: "Erro no lançamento.",
            details: err.message
        });
    }
});

// -------------------------------------------------------------
// ✏️ 6. ALTERAR LANÇAMENTO
// -------------------------------------------------------------
app.put("/lancamento/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { email, telefone, ...fields } = req.body;

        if (!email || !telefone) {
            return res.status(400).json({ error: "Email + telefone obrigatórios." });
        }

        if (Object.keys(fields).length === 0) {
            return res.status(400).json({ error: "Nenhum campo enviado para atualizar." });
        }

        const userId = await findUserIdByEmail(email);

        await db
            .collection("users")
            .doc(userId)
            .collection("transactions")
            .doc(id)
            .set(fields, { merge: true });

        res.json({ status: "sucesso", mensagem: "Lançamento atualizado." });

    } catch (err) {
        res.status(500).json({ error: "Erro ao atualizar.", details: err.message });
    }
});

// -------------------------------------------------------------
// 🗑️ 7. EXCLUIR LANÇAMENTO
// -------------------------------------------------------------
app.delete("/lancamento/:id", async (req, res) => {
    try {
        const { email, telefone } = req.body;
        const { id } = req.params;

        if (!email || !telefone) {
            return res.status(400).json({ error: "Email + telefone obrigatórios." });
        }

        const userId = await findUserIdByEmail(email);

        await db
            .collection("users")
            .doc(userId)
            .collection("transactions")
            .doc(id)
            .delete();

        res.json({ status: "sucesso", mensagem: "Lançamento excluído." });

    } catch (err) {
        res.status(500).json({ error: "Erro ao excluir.", details: err.message });
    }
});

// -------------------------------------------------------------
// 📊 8. RELATÓRIO
// -------------------------------------------------------------
app.post("/relatorio", async (req, res) => {
    try {
        const { email } = req.body;
        const userId = await findUserIdByEmail(email);

        const snapshot = await db
            .collection("users")
            .doc(userId)
            .collection("transactions")
            .orderBy("data", "desc")
            .get();

        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        res.json({ status: "sucesso", total: list.length, lancamentos: list });

    } catch (err) {
        res.status(500).json({ error: "Erro no relatório.", details: err.message });
    }
});

// -------------------------------------------------------------
// 📂 9. LISTAR CONTAS DO USUÁRIO  (NOVO ENDPOINT)
// -------------------------------------------------------------
app.get("/contas", async (req, res) => {
    try {
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({ error: "Email obrigatório." });
        }

        const userId = await findUserIdByEmail(email);

        const snapshot = await db
            .collection("users")
            .doc(userId)
            .collection("accounts")
            .get();

        const contas = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        res.json({
            status: "sucesso",
            total: contas.length,
            contas
        });

    } catch (err) {
        res.status(500).json({
            error: "Erro ao buscar contas.",
            details: err.message
        });
    }
});

// -------------------------------------------------------------
// 🚀 10. INICIAR SERVIDOR
// -------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
