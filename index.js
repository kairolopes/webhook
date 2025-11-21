// -------------------------------------------------------------
// 🚀 Servidor Webhook + Firebase Firestore — VERSÃO FINAL COMPLETA
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
// 🔥 Inicialização Firebase (Railway Safe Mode)
// -------------------------------------------------------------
try {
  const jsonString = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.GCLOUD_PROJECT;

  if (!jsonString) throw new Error("GOOGLE_APPLICATION_CREDENTIALS ausente");
  if (!projectId) throw new Error("GCLOUD_PROJECT ausente");

  const tempPath = path.join(os.tmpdir(), "firebase_key.json");
  fs.writeFileSync(tempPath, jsonString);

  admin.initializeApp({
    credential: admin.credential.cert(require(tempPath)),
    projectId,
  });

  console.log("🔥 Firebase inicializado com sucesso");
} catch (err) {
  console.error("❌ Firebase init error:", err.message);
  process.exit(1);
}

const db = admin.firestore();
const auth = admin.auth();

// -------------------------------------------------------------
// 🔧 Função: Buscar UID por email
// -------------------------------------------------------------
async function findUserIdByEmail(email) {
  const cleanEmail = email.trim().toLowerCase();

  try {
    const user = await auth.getUserByEmail(cleanEmail);
    return user.uid;
  } catch (_) {}

  const snap = await db.collection("users")
    .where("email", "==", cleanEmail)
    .limit(1)
    .get();

  if (snap.empty) {
    throw new Error("Usuário não existe (nem no Auth, nem no Firestore).");
  }

  return snap.docs[0].id;
}

// -------------------------------------------------------------
// ✅ Health check
// -------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Servidor ativo" });
});

// -------------------------------------------------------------
// 👤 Cadastro com bloqueio de duplicados
// -------------------------------------------------------------
app.post("/cadastro", async (req, res) => {
  try {
    const { email, password, nome, telefone, cpf } = req.body;

    if (!email || !password || !nome || !telefone) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanTelefone = telefone.trim();

    // ❌ Bloquear email duplicado
    try {
      await auth.getUserByEmail(cleanEmail);
      return res.status(409).json({ error: "Email já cadastrado" });
    } catch (_) {}

    // ❌ Bloquear telefone duplicado
    const telSnap = await db.collection("users")
      .where("telefone", "==", cleanTelefone)
      .limit(1)
      .get();

    if (!telSnap.empty) {
      return res.status(409).json({ error: "Telefone já cadastrado" });
    }

    // ✅ Criar no Firebase Auth
    const user = await auth.createUser({
      email: cleanEmail,
      password
    });

    // ✅ Salvar no Firestore
    await db.collection("users").doc(user.uid).set({
      email: cleanEmail,
      nome,
      telefone: cleanTelefone,
      cpf: cpf || "",
      criadoEm: new Date()
    });

    res.json({ status: "sucesso", uid: user.uid });

  } catch (err) {
    res.status(500).json({ error: "Erro no cadastro", details: err.message });
  }
});

// -------------------------------------------------------------
// 💸 Criar Lançamento
// -------------------------------------------------------------
app.post("/lancamento", async (req, res) => {
  try {
    const {
      email,
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
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const userId = await findUserIdByEmail(email);

    const accountRef = db.collection("users")
      .doc(userId)
      .collection("accounts")
      .doc(contaId);

    const account = await accountRef.get();
    if (!account.exists) {
      return res.status(404).json({ error: "Conta não encontrada" });
    }

    const parcelas = parseInt(installments);
    const valorNum = Number(valor);

    const base = {
      tipo,
      contaId,
      categoriaId,
      subcategoria: subcategoria || "",
      descricao,
      valor: valorNum,
      data,
      criadoEm: new Date(),
      installments: parcelas
    };

    const ref = db.collection("users")
      .doc(userId)
      .collection("transactions");

    if (parcelas <= 1) {
      await ref.add(base);
      return res.json({ status: "sucesso", mensagem: "Lançamento criado" });
    }

    const valorParcela = valorNum / parcelas;
    const batch = db.batch();

    for (let i = 0; i < parcelas; i++) {
      const d = new Date(data);
      d.setMonth(d.getMonth() + i);

      const item = {
        ...base,
        valor: valorParcela,
        descricao: `${descricao} (${i + 1}/${parcelas})`,
        data: d.toISOString().split("T")[0],
        isInstallment: true
      };

      const doc = ref.doc();
      batch.set(doc, item);
    }

    await batch.commit();

    res.json({ status: "sucesso", mensagem: `${parcelas} parcelas criadas` });

  } catch (err) {
    res.status(500).json({ error: "Erro no lançamento", details: err.message });
  }
});

// -------------------------------------------------------------
// 📂 Listar contas
// -------------------------------------------------------------
app.get("/contas", async (req, res) => {
  try {
    const { email } = req.query;
    const userId = await findUserIdByEmail(email);

    const snap = await db.collection("users")
      .doc(userId)
      .collection("accounts")
      .get();

    const contas = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    res.json({ status: "sucesso", contas });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 📊 Relatório
// -------------------------------------------------------------
app.post("/relatorio", async (req, res) => {
  try {
    const { email } = req.body;
    const userId = await findUserIdByEmail(email);

    const snapshot = await db.collection("users")
      .doc(userId)
      .collection("transactions")
      .orderBy("data", "desc")
      .get();

    const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

    res.json({ status: "sucesso", total: list.length, list });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 🚀 Start
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
