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
  return telefone.toString().replace(/\D/g, "");
}

// -------------------------------------------------------------
// 📅 Normalizar data (aceita DD/MM/AAAA, DD-MM-AAAA ou YYYY-MM-DD)
// -------------------------------------------------------------
function normalizarDataIso(dataStr) {
  if (!dataStr) return null;
  const s = dataStr.toString().trim();

  // Já está no formato correto
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s;
  }

  // Formato DD/MM/AAAA
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) {
    const [, dia, mes, ano] = m;
    return `${ano}-${mes}-${dia}`; // YYYY-MM-DD
  }

  // Formato DD-MM-AAAA
  m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) {
    const [, dia, mes, ano] = m;
    return `${ano}-${mes}-${dia}`;
  }

  // Qualquer outra coisa: consideramos inválida
  return null;
}

// -------------------------------------------------------------
// 🔎 Buscar usuário — SOMENTE SE EXISTIR NO AUTH
// -------------------------------------------------------------
async function getUserId(email) {
  const clean = email.trim().toLowerCase();

  try {
    const user = await auth.getUserByEmail(clean);
    return user.uid;
  } catch (err) {
    throw new Error(
      "Este e-mail não está cadastrado na plataforma. Faça login/cadastro primeiro."
    );
  }
}

// 🔢 Função reutilizável — cálculo de RECEITA em um período
async function calcularReceitaPeriodo(uid, inicio, fim, meioRaw) {
  const inicioLimpo = inicio.toString().trim();
  const fimLimpo = fim.toString().trim();

  const meio = (meioRaw || "").toString().trim().toLowerCase();

  let query = db
    .collection("users")
    .doc(uid)
    .collection("transactions")
    .where("data", ">=", inicioLimpo)
    .where("data", "<=", fimLimpo);

  if (meio && meio !== "todos") {
    query = query.where("meio", "==", meio);
  }

  const snap = await query.get();

  const docsEncontrados = snap.size;

  let totalReceita = 0;
  let qtd = 0;

  snap.forEach((doc) => {
    const dados = doc.data();

    console.log("🔎 DOC NO PERÍODO (RECEITA):", doc.id, dados);

    if (dados.tipo !== "income") return;

    const v = Number(dados.valor) || 0;
    totalReceita += v;
    qtd += 1;
  });

  return {
    inicio: inicioLimpo,
    fim: fimLimpo,
    meio: meio || "todos",
    docsEncontrados,
    totalReceita,
    quantidadeLancamentos: qtd,
  };
}

// 🔢 Função reutilizável — cálculo de gasto em um período (com debug)
async function calcularGastoPeriodo(uid, inicio, fim, meioRaw) {
  const inicioLimpo = inicio.toString().trim();
  const fimLimpo = fim.toString().trim();

  const meio = (meioRaw || "").toString().trim().toLowerCase();

  let query = db
    .collection("users")
    .doc(uid)
    .collection("transactions")
    .where("data", ">=", inicioLimpo)
    .where("data", "<=", fimLimpo);

  if (meio && meio !== "todos") {
    query = query.where("meio", "==", meio);
  }

  const snap = await query.get();

  const docsEncontrados = snap.size;

  let totalGasto = 0;
  let qtd = 0;

  snap.forEach((doc) => {
    const dados = doc.data();

    console.log("🔎 DOC NO PERÍODO (GASTO):", doc.id, dados);

    if (dados.tipo !== "expense") return;

    const v = Number(dados.valor) || 0;
    totalGasto += v;
    qtd += 1;
  });

  return {
    inicio: inicioLimpo,
    fim: fimLimpo,
    meio: meio || "todos",
    docsEncontrados,
    totalGasto,
    quantidadeLancamentos: qtd,
  };
}

// ---------------------------------------------------------
// 🔍 GET - Gasto em um período (via EMAIL)
// ---------------------------------------------------------
app.get("/gasto-periodo", async (req, res) => {
  try {
    const { email, inicio, fim } = req.query;
    const meio = req.query.meio;

    if (!email || !inicio || !fim) {
      return res.status(400).json({
        error:
          "Informe 'email', 'inicio' e 'fim' na URL (?email=...&inicio=YYYY-MM-DD&fim=YYYY-MM-DD).",
      });
    }

    const cleanEmail = email.toString().trim().toLowerCase();
    const uid = await getUserId(cleanEmail);

    const resultado = await calcularGastoPeriodo(uid, inicio, fim, meio);

    return res.json({
      total_gasto: resultado.totalGasto,
      quantidade_lancamentos: resultado.quantidadeLancamentos,
      inicio_formatado: resultado.inicio,
      fim_formatado: resultado.fim,
    });
  } catch (err) {
    console.error("Erro em GET /gasto-periodo:", err);
    return res.status(500).json({ error: err.message });
  }
});

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

    const telSnap = await db
      .collection("users")
      .where("telefone", "==", telNormalizado)
      .limit(1)
      .get();

    if (!telSnap.empty) {
      return res.status(400).json({ error: "Telefone já cadastrado" });
    }

    await db.collection("users").doc(user.uid).set({
      email: clean,
      nome,
      telefone: telNormalizado,
      cpf,
      criadoEm: new Date(),
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
      tipo,
      nome,
      saldo = 0,
      limite = 0,
      fechamento = null,
      vencimento = null,
    } = req.body;

    if (!email || !tipo || !nome) {
      return res.status(400).json({ error: "Campos obrigatórios faltando" });
    }

    const uid = await getUserId(email);

    const data = {
      tipo,
      nome: nome.trim(),
      saldo: Number(saldo),
      criadoEm: new Date(),
    };

    if (tipo === "cartao") {
      data.limite = Number(limite);
      data.fechamento = fechamento;
      data.vencimento = vencimento;
    }

    await db
      .collection("users")
      .doc(uid)
      .collection("accounts")
      .add(data);

    res.json({ status: "sucesso" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 💸 LANÇAMENTO (MESMO PADRÃO DO FRONT-END / NICOCHAT)
// -------------------------------------------------------------
app.post("/lancamento", async (req, res) => {
  try {
    console.log("💾 [LANÇAMENTO] Body recebido:", req.body);

    const {
      email,
      tipo,           // "expense" | "income"
      meio,           // "credito" | "debito" | "dinheiro" | "pix"
      cartao,         // obrigatório se for crédito
      categoriaId,
      subcategoriaId,
      descricao = "",
      valor,
      data,           // pode vir "DD/MM/AAAA" ou "YYYY-MM-DD"
      parcelas,
      installments,
    } = req.body;

    if (!email || !tipo || !meio || !categoriaId || !valor || !data) {
      console.log("⚠️ [LANÇAMENTO] Campos faltando:", {
        email,
        tipo,
        meio,
        categoriaId,
        valor,
        data,
      });
      return res.status(400).json({
        error:
          "Campos obrigatórios faltando (email, tipo, meio, categoriaId, valor, data).",
      });
    }

    const meioLimpo = meio.toString().trim().toLowerCase();

    if (meioLimpo === "credito" && !cartao) {
      console.log(
        "⚠️ [LANÇAMENTO] Crédito sem cartão informado. Body:",
        req.body
      );
      return res.status(400).json({
        error:
          "Para lançamentos no crédito, informe o nome do cartão no campo 'cartao'.",
      });
    }

    // 🔹 Normaliza a data aqui
    const dataNormalizada = normalizarDataIso(data);
    console.log(
      "🗓 [LANÇAMENTO] Data original:",
      data,
      "→ normalizada:",
      dataNormalizada
    );

    if (!dataNormalizada) {
      return res.status(400).json({
        error:
          "Data em formato inválido. Use DD/MM/AAAA ou YYYY-MM-DD.",
      });
    }

    const uid = await getUserId(email);

    const nParcelas = Number(parcelas || installments || 1);
    const totalValor = Number(valor);

    if (isNaN(totalValor) || totalValor <= 0) {
      console.log("⚠️ [LANÇAMENTO] Valor inválido:", valor);
      return res.status(400).json({ error: "Valor inválido" });
    }

    if (isNaN(nParcelas) || nParcelas < 1) {
      console.log("⚠️ [LANÇAMENTO] Número de parcelas inválido:", nParcelas);
      return res.status(400).json({ error: "Número de parcelas inválido" });
    }

    const ref = db.collection("users").doc(uid).collection("transactions");
    const grupoParcelas = nParcelas > 1 ? `PARC-${Date.now()}` : "";

    // ------------------------------
    // À vista (1 parcela)
    // ------------------------------
    if (nParcelas === 1) {
      const docData = {
        cartao: cartao || null,
        categoriaId,
        subcategoriaId: subcategoriaId || null,
        data: dataNormalizada,        // 👈 já no formato YYYY-MM-DD
        descricao,
        grupoParcelas,
        meio: meioLimpo,
        numeroParcela: 1,
        parcelado: "nao",
        parcelas: 1,
        tipo,
        valor: totalValor,
      };

      const docRef = await ref.add(docData);

      console.log(
        "✅ [LANÇAMENTO] Documento criado (à vista):",
        docRef.id,
        docData
      );

      return res.json({
        status: "sucesso",
        tipoLancamento: "avista",
        docId: docRef.id,
        dados: docData,
      });
    }

    // ------------------------------
    // Parcelado (nParcelas > 1)
    // ------------------------------
    const valorParcela = totalValor / nParcelas;
    const batch = db.batch();
    const idsParcelas = [];

    // Base da data para as parcelas
    const baseDate = new Date(dataNormalizada);

    for (let i = 0; i < nParcelas; i++) {
      const d = new Date(baseDate);
      d.setMonth(d.getMonth() + i);
      const dataParcela = d.toISOString().split("T")[0];

      const docRef = ref.doc();
      const docData = {
        cartao: cartao || null,
        categoriaId,
        subcategoriaId: subcategoriaId || null,
        data: dataParcela,
        descricao: `${descricao} (parc. ${i + 1}/${nParcelas})`,
        grupoParcelas,
        meio: meioLimpo,
        numeroParcela: i + 1,
        parcelado: "sim",
        parcelas: nParcelas,
        tipo,
        valor: valorParcela,
      };

      batch.set(docRef, docData);
      idsParcelas.push({ id: docRef.id, data: docData });
    }

    await batch.commit();

    console.log("✅ [LANÇAMENTO] Parcelas criadas:", idsParcelas);

    return res.json({
      status: "sucesso",
      tipoLancamento: "parcelado",
      parcelasCriadas: nParcelas,
      documentos: idsParcelas.map((p) => ({
        id: p.id,
        data: p.data,
      })),
    });
  } catch (err) {
    console.error("❌ Erro em POST /lancamento:", err);
    return res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 📞 BUSCAR USUÁRIO PELO TELEFONE
// -------------------------------------------------------------
app.get("/usuario-por-telefone", async (req, res) => {
  try {
    const { telefone } = req.query;

    if (!telefone) {
      return res.status(400).json({
        error: "Informe o telefone na query (?telefone=...)",
      });
    }

    const telNormalizado = normalizarTelefone(telefone);

    const snap = await db
      .collection("users")
      .where("telefone", "==", telNormalizado)
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).json({
        error: "Nenhum usuário encontrado com esse telefone",
      });
    }

    const doc = snap.docs[0];
    const dados = doc.data();

    return res.json({
      uid: doc.id,
      nome: dados.nome || null,
      email: dados.email || null,
      telefone: dados.telefone || telNormalizado,
      cpf: dados.cpf || null,
    });
  } catch (err) {
    console.error("Erro ao buscar usuário por telefone:", err);
    return res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// 🔍 CONSULTAS FINANCEIRAS (POST /consulta — Nicochat)
// -------------------------------------------------------------
app.post("/consulta", async (req, res) => {
  try {
    console.log("🔎 Body recebido em /consulta:", req.body);

    const { email, acao } = req.body;

    if (!email || !acao) {
      return res.status(400).json({
        error: "Informe 'email' e 'acao' no corpo da requisição.",
      });
    }

    const uid = await getUserId(email);

    if (acao === "gasto_periodo") {
      const { inicio, fim, meio = "todos" } = req.body;

      if (!inicio || !fim) {
        return res.status(400).json({
          error:
            "Para 'gasto_periodo' informe 'inicio' e 'fim' (YYYY-MM-DD).",
        });
      }

      const resultado = await calcularGastoPeriodo(uid, inicio, fim, meio);

      return res.set("Content-Type", "application/json").json({
        status: "sucesso",
        acao: "gasto_periodo",
        data: {
          inicio: resultado.inicio,
          fim: resultado.fim,
          meio: resultado.meio,
          docsEncontrados: resultado.docsEncontrados,
          totalGasto: resultado.totalGasto,
          quantidadeLancamentos: resultado.quantidadeLancamentos,
        },
      });
    }

    if (acao === "receita_periodo") {
      const { inicio, fim, meio = "todos" } = req.body;

      if (!inicio || !fim) {
        return res.status(400).json({
          error:
            "Para 'receita_periodo' informe 'inicio' e 'fim' (YYYY-MM-DD).",
        });
      }

      const resultado = await calcularReceitaPeriodo(uid, inicio, fim, meio);

      return res.set("Content-Type", "application/json").json({
        status: "sucesso",
        acao: "receita_periodo",
        data: {
          inicio: resultado.inicio,
          fim: resultado.fim,
          meio: resultado.meio,
          docsEncontrados: resultado.docsEncontrados,
          totalReceita: resultado.totalReceita,
          quantidadeLancamentos: resultado.quantidadeLancamentos,
        },
      });
    }

    if (acao === "saldo_por_meio") {
      const { meio = "dinheiro" } = req.body;

      const snap = await db
        .collection("users")
        .doc(uid)
        .collection("transactions")
        .where("meio", "==", meio)
        .get();

      let saldo = 0;
      snap.forEach((doc) => {
        const dados = doc.data();
        const v = Number(dados.valor) || 0;

        if (dados.tipo === "income") saldo += v;
        else if (dados.tipo === "expense") saldo -= v;
      });

      return res.json({
        status: "sucesso",
        acao: "saldo_por_meio",
        meio,
        saldo,
        quantidadeLancamentos: snap.size,
      });
    }

    if (acao === "limite_cartao") {
      const { cartao } = req.body;

      if (!cartao) {
        return res.status(400).json({
          error:
            "Para 'limite_cartao' informe o campo 'cartao' (nome do cartão).",
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

    return res.status(400).json({
      error:
        "Ação de consulta inválida. Use 'gasto_periodo', 'receita_periodo', 'saldo_por_meio' ou 'limite_cartao'.",
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
