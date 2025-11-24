// -------------------------------------------------------------
// 🚀 API PLANILSON — PADRÃO POR NOME DE CONTA
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
// 🔥 Firebase
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
// 🔎 Buscar usuário — SOMENTE SE EXISTIR NO AUTH
// -------------------------------------------------------------
async function getUserId(email) {
  const clean = email.trim().toLowerCase();

  try {
    const user = await auth.getUserByEmail(clean);
    return user.uid; // Só aceita se tiver cadastro no Authentication
  } catch (err) {
    throw new Error(
      "Este e-mail não está cadastrado na plataforma. Faça login/cadastro primeiro."
    );
  }
}


// -------------------------------------------------------------
// ✅ HEALTH
// -------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// -------------------------------------------------------------
// 👤 CADASTRO DE USUÁRIO
// -------------------------------------------------------------
app.post("/cadastro", async (req, res) => {
  try {
    const { email, password, nome, telefone, cpf } = req.body;
    if (!email || !password || !nome || !telefone) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const clean = email.toLowerCase().trim();

    let user;
    try {
      user = await auth.createUser({ email: clean, password });
    } catch (err) {
      if (err.code === "auth/email-already-exists") {
        return res.status(400).json({ error: "Email já cadastrado" });
      } else throw err;
    }

    // Bloqueio telefone duplicado
    const telSnap = await db.collection("users")
      .where("telefone", "==", telefone).limit(1).get();

    if (!telSnap.empty) {
      return res.status(400).json({ error: "Telefone já cadastrado" });
    }

    await db.collection("users").doc(user.uid).set({
      email: clean, nome, telefone, cpf, criadoEm: new Date()
    });

    res.json({ status: "sucesso", uid: user.uid });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 🏦 CRIAR CONTA (NOME NORMAL)
// -------------------------------------------------------------
app.post("/conta", async (req, res) => {
  try {
    const {
      email,
      tipo,        // caixinha | corrente | cartao
      nome,        // Ex: Nubank
      saldo = 0,

      // Só para cartão:
      limite = 0,
      fechamento = null,
      vencimento = null
    } = req.body;

    if (!email || !tipo || !nome) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const uid = await getUserId(email);

    const data = {
      tipo,
      nome: nome.trim(),
      saldo: Number(saldo),
      criadoEm: new Date()
    };

    if (tipo === "cartao") {
      data.limite = Number(limite);
      data.fechamento = fechamento;
      data.vencimento = vencimento;
    }

    await db.collection("users").doc(uid)
      .collection("accounts")
      .add(data);

    res.json({ status: "sucesso" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 💸 LANÇAMENTO (PROCURA CONTA PELO NOME)
// -------------------------------------------------------------
app.post("/lancamento", async (req, res) => {
  try {
    const {
      email,
      tipo,
      contaNome,         // << AGORA É NOME, NÃO ID
      categoriaId,
      subcategoria = "",
      descricao = "",
      valor,
      data,
      installments = 1
    } = req.body;

    if (!email || !contaNome || !valor || !data) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const uid = await getUserId(email);

    // 🔍 Busca conta pelo NOME
    const accSnap = await db.collection("users")
      .doc(uid)
      .collection("accounts")
      .where("nome", "==", contaNome.trim())
      .limit(1)
      .get();

    if (accSnap.empty) {
      return res.status(404).json({ error: "Conta não encontrada pelo nome" });
    }

    const accId = accSnap.docs[0].id;

    const base = {
      tipo,
      contaNome,
      contaId: accId,
      categoriaId,
      subcategoria,
      descricao,
      valor: Number(valor),
      data,
      criadoEm: new Date(),
      installments: Number(installments)
    };

    const ref = db.collection("users")
      .doc(uid).collection("transactions");

    const n = Number(installments);

    if (n <= 1) {
      await ref.add(base);
      return res.json({ status: "sucesso" });
    }

    const v = base.valor / n;
    const batch = db.batch();

    for (let i = 0; i < n; i++) {
      const d = new Date(data);
      d.setMonth(d.getMonth() + i);

      const docRef = ref.doc();
      batch.set(docRef, {
        ...base,
        valor: v,
        descricao: `${descricao} (${i + 1}/${n})`,
        data: d.toISOString().split("T")[0],
        isInstallment: true
      });
    }

    await batch.commit();

    res.json({ status: "sucesso", parcelas: n });

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
