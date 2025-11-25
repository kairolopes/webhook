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
// 📌 Normalizar telefone (remove tudo que não seja número)
// -------------------------------------------------------------
function normalizarTelefone(telefone) {
  if (!telefone) return "";
  return telefone.toString().replace(/\D/g, ""); // só dígitos
}


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
    const telNormalizado = normalizarTelefone(telefone);

    let user;
    try {
      user = await auth.createUser({ email: clean, password });
    } catch (err) {
      if (err.code === "auth/email-already-exists") {
        return res.status(400).json({ error: "Email já cadastrado" });
      } else throw err;
    }

    // Bloqueio telefone duplicado (já usando o telefone normalizado)
    const telSnap = await db.collection("users")
      .where("telefone", "==", telNormalizado).limit(1).get();

    if (!telSnap.empty) {
      return res.status(400).json({ error: "Telefone já cadastrado" });
    }

    await db.collection("users").doc(user.uid).set({
      email: clean,
      nome,
      telefone: telNormalizado,   // 👈 salva só os dígitos
      cpf,
      criadoEm: new Date()
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
    const { telefone } = req.query; // ex: /usuario-por-telefone?telefone=+5562...

    if (!telefone) {
      return res.status(400).json({
        error: "Informe o telefone na query (?telefone=...)"
      });
    }

    // Normaliza o telefone que veio da URL (tira +, (), -, espaço, etc.)
    const telNormalizado = normalizarTelefone(telefone);

    // Procura na coleção users quem tem esse telefone normalizado
    const snap = await db
      .collection("users")
      .where("telefone", "==", telNormalizado)
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
      telefone: dados.telefone || telNormalizado,
      cpf: dados.cpf || null
    });

  } catch (err) {
    console.error("Erro ao buscar usuário por telefone:", err);
    return res.status(500).json({ error: err.message });
  }
});


// -------------------------------------------------------------
// 🔍 CONSULTAS FINANCEIRAS
// -------------------------------------------------------------
// Este endpoint NÃO entende linguagem natural.
// A IA deve enviar um JSON já estruturado com:
// {
//   "email": "...",
//   "acao": "gasto_periodo" | "saldo_por_meio" | "limite_cartao",
//   ...outros campos conforme a ação...
// }
app.post("/consulta", async (req, res) => {
  try {
    const { email, acao } = req.body;

    if (!email || !acao) {
      return res.status(400).json({
        error: "Informe 'email' e 'acao' no corpo da requisição."
      });
    }

    const uid = await getUserId(email); // garante que o usuário existe

    // ---------------------------------------------------------
    // 1) Quanto gastei em um período? (ex: essa semana)
    // acao = "gasto_periodo"
    // body:
    // {
    //   "email": "...",
    //   "acao": "gasto_periodo",
    //   "inicio": "2025-11-24",
    //   "fim": "2025-11-30",
    //   "meio": "todos" | "dinheiro" | "credito" | "debito"
    // }
    // ---------------------------------------------------------
    if (acao === "gasto_periodo") {
      const { inicio, fim, meio = "todos" } = req.body;

      if (!inicio || !fim) {
        return res.status(400).json({
          error: "Para 'gasto_periodo' informe 'inicio' e 'fim' (YYYY-MM-DD)."
        });
      }

      
    // ---------------------------------------------------------
    // 2) Quanto tenho ainda em dinheiro?
    // acao = "saldo_por_meio"
    // body:
    // {
    //   "email": "...",
    //   "acao": "saldo_por_meio",
    //   "meio": "dinheiro"   // ou "debito", "credito", etc.
    // }
    // Saldo = entradas (income) - saídas (expense) daquele "meio".
    // ---------------------------------------------------------
    if (acao === "saldo_por_meio") {
      const { meio = "dinheiro" } = req.body;

      const snap = await db
        .collection("users")
        .doc(uid)
        .collection("transactions")
        .where("meio", "==", meio)
        .get();


let query = db
  .collection("users")
  .doc(uid)
  .collection("transactions")
  .where("data", ">=", inicio)
  .where("data", "<=", fim);

if (meio !== "todos") {
  query = query.where("meio", "==", meio);
}

const snap = await query.get();

let totalGasto = 0;
let qtd = 0;

snap.forEach((doc) => {
  const dados = doc.data();

  // filtra só despesas aqui no código, não na query
  if (dados.tipo !== "expense") return;

  const v = Number(dados.valor) || 0;
  totalGasto += v;
  qtd += 1;
});

return res.json({
  status: "sucesso",
  acao: "gasto_periodo",
  inicio,
  fim,
  meio,
  totalGasto,
  quantidadeLancamentos: qtd,
});

    }

    // ---------------------------------------------------------
    // 3) Qual meu limite do cartão X?
    // acao = "limite_cartao"
    // body:
    // {
    //   "email": "...",
    //   "acao": "limite_cartao",
    //   "cartao": "Neon"
    // }
    // Usa a coleção "accounts" (tipo = "cartao")
    // ---------------------------------------------------------
    if (acao === "limite_cartao") {
      const { cartao } = req.body;

      if (!cartao) {
        return res.status(400).json({
          error: "Para 'limite_cartao' informe o campo 'cartao' (nome do cartão).",
        });
      }

      const snap = await db
        .collection("users")
        .doc(uid)
        .collection("accounts")
        .where("tipo", "==", "cartao")
        .where("nome", "==", cartao.trim())
        .limit(1)
        .get();

      if (snap.empty) {
        return res.status(404).json({
          error: `Nenhuma conta de cartão encontrada com o nome '${cartao}'.`,
        });
      }

      const conta = snap.docs[0].data();

      return res.json({
        status: "sucesso",
        acao: "limite_cartao",
        cartao: conta.nome,
        limite: Number(conta.limite) || 0,
        fechamento: conta.fechamento || null,
        vencimento: conta.vencimento || null,
      });
    }

    // ---------------------------------------------------------
    // Ação desconhecida
    // ---------------------------------------------------------
    return res.status(400).json({
      error: "Ação de consulta inválida. Use 'gasto_periodo', 'saldo_por_meio' ou 'limite_cartao'.",
    });

  } catch (err) {
    console.error("Erro em /consulta:", err);
    return res.status(500).json({ error: err.message });
  }
});


// -------------------------------------------------------------
// 🚀 START
// -------------------------------------------------------------
app.listen(PORT, () => {
  console.log("🚀 API rodando na porta", PORT);
});
