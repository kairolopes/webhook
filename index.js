// -------------------------------------------------------------
// 🚀 Servidor Webhook + Firebase Firestore — VERSÃO COMPLETA FINAL
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
// 🔥 Firebase Init (Railway Safe)
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
  console.error("❌ Firebase ERROR:", err.message);
  process.exit(1);
}

const db = admin.firestore();
const auth = admin.auth();

// -------------------------------------------------------------
// 🔧 Função - Buscar usuário por email (Auth + Firestore)
// -------------------------------------------------------------
async function findUserIdByEmail(email) {
  const cleanEmail = email.trim().toLowerCase();

  try {
    const user = await auth.getUserByEmail(cleanEmail);
    return user.uid;
  } catch (_) {
    const snap = await db.collection("users")
      .where("email", "==", cleanEmail)
      .limit(1)
      .get();

    if (snap.empty) {
      throw new Error("Usuário não encontrado");
    }

    return snap.docs[0].id;
  }
}

// -------------------------------------------------------------
// 🔧 Função - Similaridade simples de nome de conta (JS puro)
// -------------------------------------------------------------
function findContaSimilar(contas, textoBusca) {
  const busca = textoBusca.toLowerCase();

  let melhor = null;
  let maiorPontuacao = 0;

  contas.forEach(conta => {
    const nome = (conta.nome || "").toLowerCase();

    let pontos = 0;
    for (let letra of busca) {
      if (nome.includes(letra)) {
        pontos++;
      }
    }

    if (pontos > maiorPontuacao) {
      maiorPontuacao = pontos;
      melhor = conta;
    }
  });

  return melhor;
}

// -------------------------------------------------------------
// ✅ Rota teste
// -------------------------------------------------------------
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// -------------------------------------------------------------
// 👤 CADASTRO - BLOQUEIA EMAIL E TELEFONE REPETIDOS
// -------------------------------------------------------------
app.post("/cadastro", async (req, res) => {
  try {
    const { email, password, nome, telefone, cpf } = req.body;

    if (!email || !password || !nome || !telefone) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = telefone.trim();

    // 🔒 Verificar telefone duplicado
    const telSnap = await db.collection("users")
      .where("telefone", "==", cleanPhone)
      .limit(1)
      .get();

    if (!telSnap.empty) {
      return res.status(409).json({ error: "Telefone já cadastrado" });
    }

    let user;

    try {
      user = await auth.createUser({
        email: cleanEmail,
        password
      });
    } catch (err) {
      if (err.code === "auth/email-already-exists") {
        return res.status(409).json({ error: "Email já cadastrado" });
      }
      throw err;
    }

    await db.collection("users").doc(user.uid).set({
      email: cleanEmail,
      nome,
      telefone: cleanPhone,
      cpf,
      criadoEm: new Date()
    });

    res.json({
      status: "sucesso",
      uid: user.uid
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 💸 LANÇAMENTO — COM contaId OU contaNome (similaridade)
// -------------------------------------------------------------
app.post("/lancamento", async (req, res) => {
  try {
    const {
      email,
      tipo,
      contaId,
      contaNome,
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

    let contaIdFinal = "SEM_CONTA";

    // 1) Se veio contaId, usa direto
    if (contaId) {
      contaIdFinal = contaId;
    }

    // 2) Se veio contaNome, busca parecido
    if (!contaId && contaNome) {
      const snap = await db.collection("users")
        .doc(userId)
        .collection("accounts")
        .get();

      const contas = snap.docs.map(d => ({
        id: d.id,
        nome: d.data().name || d.data().nome || ""
      }));

      const conta = findContaSimilar(contas, contaNome);
      if (conta) {
        contaIdFinal = conta.id;
      }
    }

    const ref = db.collection("users")
      .doc(userId)
      .collection("transactions");

    const n = Number(installments);

    const base = {
      tipo,
      contaId: contaIdFinal,
      contaNomeDigitado: contaNome || "",
      categoriaId,
      subcategoria,
      descricao,
      valor: Number(valor),
      data,
      criadoEm: new Date(),
      installments: n
    };

    // ➕ SE NÃO FOR PARCELADO
    if (n <= 1) {
      await ref.add(base);
      return res.json({ status: "sucesso", mensagem: "Lançamento criado" });
    }

    // ➕ SE FOR PARCELADO
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
      mensagem: `${n} parcelas criadas`
    });

  } catch (err) {
    res.status(500).json({
      error: "Erro no lançamento",
      details: err.message
    });
  }
});

// -------------------------------------------------------------
// 📂 LISTAR CONTAS
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
// 📊 LISTAR TRANSAÇÕES
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
