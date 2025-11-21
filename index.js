// -------------------------------------------------------------
// 🚀 Servidor Webhook + Firebase Firestore — VERSÃO FINAL
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
// 🔥 1. Inicialização Firebase (Railway Safe Mode)
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
// 🔧 2. Buscar UID por Email (Auth + Firestore)
// -------------------------------------------------------------
async function findUserIdByEmail(email) {
  const cleanEmail = email.trim().toLowerCase();

  // Primeiro tenta no Auth
  try {
    const user = await auth.getUserByEmail(cleanEmail);
    return user.uid;
  } catch (_) {}

  // Depois no Firestore
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
// 🧪 3. Health check
// -------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Servidor ativo" });
});

// -------------------------------------------------------------
// 👤 4. Cadastro de Usuário
// -------------------------------------------------------------
app.post("/cadastro", async (req, res) => {
  try {
    const { email, password, nome, telefone, cpf } = req.body;

    if (!email || !password || !nome || !telefone) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const cleanEmail = email.trim().toLowerCase();

    let user;
    try {
      user = await auth.createUser({
        email: cleanEmail,
        password
      });
    } catch (err) {
      if (err.code === "auth/email-already-exists") {
        const existing = await auth.getUserByEmail(cleanEmail);
        user = existing;
      } else {
        throw err;
      }
    }

    await db.collection("users").doc(user.uid).set({
      email: cleanEmail,
      nome,
      telefone,
      cpf,
      criadoEm: new Date()
    }, { merge: true });

    res.json({ status: "sucesso", uid: user.uid });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 💸 5. Criar Lançamento
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

    const ref = db.collection("users")
      .doc(userId)
      .collection("transactions");

    if (n <= 1) {
      await ref.add(base);
      return res.json({ status: "sucesso", mensagem: "Lançamento criado" });
    }

    const each = base.valor / n;
    const batch = db.batch();

    for (let i = 0; i < n; i++) {
      const d = new Date(data);
      d.setMonth(d.getMonth() + i);

      const item = {
        ...base,
        valor: each,
        descricao: `${descricao} (${i + 1}/${n})`,
        data: d.toISOString().split("T")[0],
        isInstallment: true
      };

      const doc = ref.doc();
      batch.set(doc, item);
    }

    await batch.commit();
    res.json({ status: "sucesso", mensagem: `${n} parcelas criadas` });

  } catch (err) {
    res.status(500).json({ error: "Erro no lançamento", details: err.message });
  }
});

// -------------------------------------------------------------
// ✏️ 6. Editar Lançamento
// -------------------------------------------------------------
app.put("/lancamento/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { email, telefone, ...fields } = req.body;

    if (!email || !telefone) {
      return res.status(400).json({ error: "Email e telefone obrigatórios" });
    }

    const userId = await findUserIdByEmail(email);

    await db.collection("users")
      .doc(userId)
      .collection("transactions")
      .doc(id)
      .set(fields, { merge: true });

    res.json({ status: "sucesso" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 🗑️ 7. Excluir Lançamento
// -------------------------------------------------------------
app.delete("/lancamento/:id", async (req, res) => {
  try {
    const { email, telefone } = req.body;
    const { id } = req.params;

    if (!email || !telefone) {
      return res.status(400).json({ error: "Email + telefone obrigatórios" });
    }

    const userId = await findUserIdByEmail(email);

    await db.collection("users")
      .doc(userId)
      .collection("transactions")
      .doc(id)
      .delete();

    res.json({ status: "sucesso" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 📊 8. Relatório
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
// 📂 9. Listar Contas
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
// 🚀 10. Start
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
