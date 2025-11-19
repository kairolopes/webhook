// -------------------------------------------------------------
// 🚀 Servidor Webhook + Firebase Firestore + Autenticação
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
// 1. 🔥 INICIALIZAÇÃO DO FIREBASE (MODELO CORRETO PARA RAILWAY)
// -------------------------------------------------------------

try {
    const jsonString = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const projectId = process.env.GCLOUD_PROJECT;

    if (!jsonString) throw new Error("Variável GOOGLE_APPLICATION_CREDENTIALS vazia.");
    if (!projectId) throw new Error("Variável GCLOUD_PROJECT vazia.");

    const tempPath = path.join(os.tmpdir(), "firebase_key.json");
    fs.writeFileSync(tempPath, jsonString);

    admin.initializeApp({
        credential: admin.credential.cert(require(tempPath)),
        projectId,
    });

    console.log("🔥 Firebase inicializado com sucesso!");
} catch (err) {
    console.error("❌ Erro ao inicializar Firebase:", err);
    process.exit(1);
}

const db = admin.firestore();
const auth = admin.auth();

// -------------------------------------------------------------
// 2. 🌐 ROTA DE TESTE
// -------------------------------------------------------------

app.get("/", (req, res) => {
    res.send("Webhook ativo no Railway!");
});

// -------------------------------------------------------------
// 3. 🤖 ROTA WEBHOOK GERAL
// -------------------------------------------------------------

app.post("/webhook", (req, res) => {
    return res.json({
        status: "success",
        received: req.body
    });
});

// -------------------------------------------------------------
// 4. 🧑‍💼 CADASTRO DE USUÁRIO
// -------------------------------------------------------------

app.post("/cadastro", async (req, res) => {
    try {
        const { email, password, nome, telefone, cpf } = req.body;

        if (!email || !password || !telefone) {
            return res.status(400).json({ error: "Campos obrigatórios faltando." });
        }

        // 1 — Criar usuário no Auth
        const userRecord = await auth.createUser({
            email,
            password
        });

        // 2 — Salvar no Firestore
        await db.collection("users").doc(userRecord.uid).set({
            email,
            nome,
            telefone,
            cpf,
            criadoEm: new Date()
        });

        return res.json({
            status: "sucesso",
            mensagem: "Usuário cadastrado!",
            uid: userRecord.uid
        });

    } catch (error) {
        return res.status(500).json({
            error: "Erro ao cadastrar.",
            details: error.message
        });
    }
});

// -------------------------------------------------------------
// 5. 💸 LANÇAMENTO FINANCEIRO (VALIDA TELEFONE + EMAIL)
// -------------------------------------------------------------

app.post("/lancamento", async (req, res) => {
    try {
        const { email, telefone, tipo, valor, descricao } = req.body;

        if (!email || !telefone || !tipo || !valor) {
            return res.status(400).json({ error: "Dados obrigatórios faltando." });
        }

        // 1 — Buscar usuário
        const snapshot = await db.collection("users")
            .where("email", "==", email)
            .where("telefone", "==", telefone)
            .get();

        if (snapshot.empty) {
            return res.status(401).json({
                error: "Usuário não encontrado ou telefone não corresponde ao email."
            });
        }

        const userId = snapshot.docs[0].id;

        // 2 — Registrar lançamento
        await db.collection("users")
            .doc(userId)
            .collection("lancamentos")
            .add({
                tipo,
                valor,
                descricao: descricao || "",
                data: new Date()
            });

        return res.json({
            status: "sucesso",
            mensagem: "Lançamento registrado."
        });

    } catch (error) {
        return res.status(500).json({
            error: "Erro ao registrar lançamento.",
            details: error.message
        });
    }
});

// -------------------------------------------------------------
// 6. 📊 RELATÓRIO FINANCEIRO
// -------------------------------------------------------------

app.post("/relatorio", async (req, res) => {
    try {
        const { email, telefone } = req.body;

        // 1 — Validar usuário
        const snapshot = await db.collection("users")
            .where("email", "==", email)
            .where("telefone", "==", telefone)
            .get();

        if (snapshot.empty) {
            return res.status(401).json({
                error: "Usuário não encontrado."
            });
        }

        const userId = snapshot.docs[0].id;

        // 2 — Buscar lançamentos
        const lancamentos = await db.collection("users")
            .doc(userId)
            .collection("lancamentos")
            .orderBy("data", "desc")
            .get();

        const lista = lancamentos.docs.map(doc => doc.data());

        return res.json({
            status: "sucesso",
            total: lista.length,
            lancamentos: lista
        });

    } catch (error) {
        res.status(500).json({
            error: "Erro ao gerar relatório.",
            details: error.message
        });
    }
});

// -------------------------------------------------------------
// 7. 🚀 INICIAR SERVIDOR
// -------------------------------------------------------------

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
