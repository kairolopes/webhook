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
// 💸 LANÇAMENTO (MESMO PADRÃO DO FRONT-END)
// -------------------------------------------------------------
app.post("/lancamento", async (req, res) => {
  try {
    const {
      email,
      tipo,             // "expense" | "income"
      meio,             // "credito" | "debito" | "dinheiro"
      cartao,           // ex: "Neon"
      categoriaId,
      subcategoriaId,
      descricao = "",
      valor,
      data,
      parcelas,         // preferencial
      installments      // opcional: alias para parcelas
    } = req.body;

    // Validação básica
    if (!email || !tipo || !meio || !cartao || !categoriaId || !valor || !data) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const uid = await getUserId(email); // garante que o e-mail existe no Auth

    const nParcelas = Number(parcelas || installments || 1);
    const totalValor = Number(valor);

    if (isNaN(totalValor) || totalValor <= 0) {
      return res.status(400).json({ error: "Valor inválido" });
    }

    if (isNaN(nParcelas) || nParcelas < 1) {
      return res.status(400).json({ error: "Número de parcelas inválido" });
    }

    const ref = db.collection("users").doc(uid).collection("transactions");

    // Mesmo padrão do front: grupoParcelas só faz sentido quando é parcelado
    const grupoParcelas = nParcelas > 1 ? `PARC-${Date.now()}` : "";

    // 👉 Lançamento à vista (1 parcela)
    if (nParcelas === 1) {
      await ref.add({
        cartao,
        categoriaId,
        subcategoriaId,
        data,
        descricao,
        grupoParcelas,
        meio,
        numeroParcela: 1,
        parcelado: "nao",
        parcelas: 1,
        tipo,
        valor: totalValor
      });

      return res.json({ status: "sucesso" });
    }

    // 👉 Lançamento parcelado (2+ parcelas)
    const valorParcela = totalValor / nParcelas;
    const batch = db.batch();

    for (let i = 0; i < nParcelas; i++) {
      const d = new Date(data);
      d.setMonth(d.getMonth() + i); // mês seguinte para cada parcela

      const docRef = ref.doc();
      batch.set(docRef, {
        cartao,
        categoriaId,
        subcategoriaId,
        data: d.toISOString().split("T")[0],
        descricao: `${descricao} (parc. ${i + 1}/${nParcelas})`,
        grupoParcelas,
        meio,
        numeroParcela: i + 1,
        parcelado: "sim",
        parcelas: nParcelas,
        tipo,
        valor: valorParcela
      });
    }

    await batch.commit();
    res.json({ status: "sucesso", parcelas: nParcelas });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 📞 BUSCAR USUÁRIO PELO TELEFONE
// -------------------------------------------------------------
app.get("/usuario-por-telefone", async (req, res) => {
  try {
    const { telefone } = req.query; // ex: /usuario-por-telefone?telefone=62999999999

    if (!telefone) {
      return res.status(400).json({
        error: "Informe o telefone na query (?telefone=...)"
      });
    }

    // Procura na coleção users quem tem esse telefone
    const snap = await db
      .collection("users")
      .where("telefone", "==", telefone)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).json({
        error: "Nenhum usuário encontrado com esse telefone"
      });
    }

    const doc = snap.docs[0];
    const dados = doc.data();

    return res.json({
      uid: doc.id,
      nome: dados.nome || null,
      email: dados.email || null,
      telefone: dados.telefone || telefone,
      cpf: dados.cpf || null
    });

  } catch (err) {
    console.error("Erro ao buscar usuário por telefone:", err);
    return res.status(500).json({ error: err.message });
  }
});


// -------------------------------------------------------------
// 🚀 START
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log("🚀 API rodando na porta", PORT);
});
