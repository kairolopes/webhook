// -------------------------------------------------------------
// 🚀 Servidor Webhook + Firebase Firestore — FINAL FUNCIONAL
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
// 🔥 Inicialização Firebase (Railway Safe)
// -------------------------------------------------------------
try {
  const jsonString = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const projectId = process.env.GCLOUD_PROJECT;

  const tempPath = path.join(os.tmpdir(), "firebase_key.json");
  fs.writeFileSync(tempPath, jsonString);

  admin.initializeApp({
    credential: admin.credential.cert(require(tempPath)),
    projectId,
  });

  console.log("✅ Firebase conectado");
} catch (err) {
  console.error("Firebase ERROR:", err.message);
  process.exit(1);
}

const db = admin.firestore();
const auth = admin.auth();

// -------------------------------------------------------------
// 🔎 Buscar usuário
// -------------------------------------------------------------
async function findUserIdByEmail(email) {
  const cleanEmail = email.trim().toLowerCase();
  try {
    const user = await auth.getUserByEmail(cleanEmail);
    return user.uid;
  } catch (err) {
    const snap = await db.collection("users")
      .where("email", "==", cleanEmail)
      .limit(1)
      .get();

    if (snap.empty) throw new Error("Usuário não encontrado");

    return snap.docs[0].id;
  }
}

// -------------------------------------------------------------
// ✅ TESTE
// -------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// -------------------------------------------------------------
// 💸 CRIAR LANÇAMENTO — SEM BLOQUEAR CONTA
// -------------------------------------------------------------
app.post("/lancamento", async (req, res) => {
  try {
    const {
      email,
      tipo,
      contaId,
      categoriaId,
      subcategoria = "",
      descricao = "",
      valor,
      data,
      installments = 1
    } = req.body;

    if (!email || !valor || !data) {
      return res.status(400).json({ error: "Campos mínimos faltando" });
    }

    const userId = await findUserIdByEmail(email);

    // ✅ NÃO BLOQUEIA SE CONTA NÃO EXISTIR
    let contaExiste = false;
    if (contaId) {
      const accSnap = await db.collection("users")
        .doc(userId)
        .collection("accounts")
        .doc(contaId)
        .get();

      contaExiste = accSnap.exists;
    }

    const base = {
      tipo,
      contaId: contaExiste ? contaId : "SEM_CONTA",
      categoriaId,
      subcategoria,
      descricao,
      valor: Number(valor),
      data,
      criadoEm: new Date(),
      installments: Number(installments)
    };

    const ref = db.collection("users")
      .doc(userId)
      .collection("transactions");

    const n = Number(installments);

    if (n <= 1) {
      await ref.add(base);
      return res.json({ status: "sucesso", mensagem: "Lançamento salvo" });
    }

    const valorParcela = base.valor / n;
    const batch = db.batch();

    for (let i = 0; i < n; i++) {
      const d = new Date(data);
      d.setMonth(d.getMonth() + i);

      const item = {
        ...base,
        valor: valorParcela,
        descricao: `${descricao} (${i + 1}/${n})`,
        data: d.toISOString().split("T")[0],
        isInstallment: true
      };

      const docRef = ref.doc();
      batch.set(docRef, item);
    }

    await batch.commit();

    res.json({
      status: "sucesso",
      mensagem: "Parcelas criadas com sucesso"
    });

  } catch (err) {
    res.status(500).json({
      error: "Erro no lançamento",
      details: err.message
    });
  }
});

// -------------------------------------------------------------
// 📄 Listar Contas
// -------------------------------------------------------------
app.get("/contas", async (req, res) => {
  try {
    const { email } = req.query;
    const userId = await findUserIdByEmail(email);

    const snap = await db.collection("users")
      .doc(userId)
      .collection("accounts")
      .get();

    const contas = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    res.json({ status: "sucesso", contas });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 📊 Listar Lançamentos
// -------------------------------------------------------------
app.get("/transacoes", async (req, res) => {
  try {
    const { email } = req.query;
    const userId = await findUserIdByEmail(email);

    const snap = await db.collection("users")
      .doc(userId)
      .collection("transactions")
      .orderBy("criadoEm", "desc")
      .get();

    const list = snap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    res.json({ status: "sucesso", list });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 🚀 START
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log("🚀 API rodando na porta", PORT);
});
