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
admin.initializeApp();
console.log("✅ Firebase conectado");


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
// 📌 Normalizar DATA (BR -> ISO YYYY-MM-DD)
//   - Aceita: "08/12/2025", "08-12-2025"
//   - Se já vier "2025-12-08", mantém
// -------------------------------------------------------------
function normalizarData(dataStr) {
  if (!dataStr) return null;

  const s = dataStr.toString().trim();

  // Já está em ISO? (YYYY-MM-DD)
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoMatch) {
    return s; // já está certinho
  }

  // Formato brasileiro: DD/MM/AAAA ou DD-MM-AAAA
  const brMatch = /^(\d{2})[\/-](\d{2})[\/-](\d{4})$/.exec(s);
  if (brMatch) {
    const [, dd, mm, yyyy] = brMatch;
    // 08/12/2025 -> 2025-12-08
    return `${yyyy}-${mm}-${dd}`;
  }

  console.log("⚠️ [DATA] Formato desconhecido, mantendo como veio:", s);
  return s;
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

// 🔢 Função reutilizável — cálculo de RECEITA em um período (RETORNA LISTA)
async function calcularReceitaPeriodo(uid, inicio, fim, meioRaw, limiteRaw) {
  const inicioLimpo = inicio.toString().trim();
  const fimLimpo = fim.toString().trim();

  const meio = (meioRaw || "").toString().trim().toLowerCase();
  const limite = Number(limiteRaw || 50); // padrão 50

  let query = db
    .collection("users")
    .doc(uid)
    .collection("transactions")
    .where("data", ">=", inicioLimpo)
    .where("data", "<=", fimLimpo)
    .where("tipo", "==", "income"); // ✅ não busca expense

  if (meio && meio !== "todos") {
    query = query.where("meio", "==", meio);
  }

  // ✅ ordena por data + limita (pra não explodir no WhatsApp)
  query = query.orderBy("data", "desc").limit(limite);

  const snap = await query.get();

  let totalReceita = 0;
  const lancamentos = [];

  snap.forEach((docSnap) => {
    const dados = docSnap.data();
    const v = Number(dados.valor) || 0;
    totalReceita += v;

    lancamentos.push({
      id: docSnap.id,
      data: dados.data || null,
      descricao: dados.descricao || null,
      valor: v,
      meio: dados.meio || null,
      cartao: dados.cartao || null,
      categoriaId: dados.categoriaId || null,
      subcategoriaId: dados.subcategoriaId || dados.subcategoria || null,
      parcelas: dados.parcelas || dados.installments || 1,
      parcelado: dados.parcelado || (dados.isInstallment ? "sim" : "nao") || null,
    });
  });

  return {
    inicio: inicioLimpo,
    fim: fimLimpo,
    meio: meio || "todos",
    docsEncontrados: snap.size,
    totalReceita,
    quantidadeLancamentos: snap.size,
    lancamentos,
  };
}

// 🔢 Função reutilizável — cálculo de gasto em um período (RETORNA LISTA)
async function calcularGastoPeriodo(uid, inicio, fim, meioRaw, limiteRaw) {
  const inicioLimpo = inicio.toString().trim();
  const fimLimpo = fim.toString().trim();

  const meio = (meioRaw || "").toString().trim().toLowerCase();
  const limite = Number(limiteRaw || 50); // padrão 50

  let query = db
    .collection("users")
    .doc(uid)
    .collection("transactions")
    .where("data", ">=", inicioLimpo)
    .where("data", "<=", fimLimpo)
    .where("tipo", "==", "expense"); // ✅ não busca income

  if (meio && meio !== "todos") {
    query = query.where("meio", "==", meio);
  }

  // ✅ ordena por data + limita (pra não explodir no WhatsApp)
query = query.orderBy("data", "desc").limit(limite);

console.log("🚦 [GASTO] Vai rodar query no Firestore...");
const snap = await query.get();
console.log("✅ [GASTO] Query OK. docs:", snap.size);

let totalGasto = 0;
let qtd = 0;
let itens = [];


snap.forEach((docSnap) => {
  const dados = docSnap.data();
  console.log("📄 [GASTO_DOC]", docSnap.id, dados);


  if (dados.tipo !== "expense") return;

  const valor = Number(dados.valor) || 0;

  totalGasto += valor;
  qtd += 1;

  itens.push({
    id: docSnap.id,
    data: dados.data,
    descricao: dados.descricao || "",
    valor,
    categoria: dados.categoriaId || null,
    subcategoria: dados.subcategoriaId || null,
    meio: dados.meio || null,
    cartao: dados.cartao || null,
    parcelado: dados.parcelado || "nao"
  });
});

return {
  inicio: inicioLimpo,
  fim: fimLimpo,
  meio: meio || "todos",
  docsEncontrados: snap.size,
  totalGasto,
  quantidadeLancamentos: qtd,
  lancamentos: itens, // ✅ agora volta gasto por gasto no payload do POST
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
// 📄 MODELOS DE RELATÓRIO (para o front montar os botões)
// -------------------------------------------------------------
const MODELOS_RELATORIO = [
  {
    id: "mes_completo",
    titulo: "Relatório completo do mês",
    descricao: "Resumo + previsão + sugestões + tabela por categorias",
    handlerFront: "gerarPdfResumoMes",
  },
  {
    id: "categorias_mes",
    titulo: "Despesas por categoria",
    descricao: "Tabela de categorias do mês selecionado",
    handlerFront: "gerarPdfCategoriasMes",
  },
  {
    id: "plano_objetivo",
    titulo: "Plano de objetivo",
    descricao: "Plano mensal para atingir um objetivo",
    handlerFront: "gerarPdfPlanoObjetivo",
  },
];

// -------------------------------------------------------------
// 🔍 GET - Lista de modelos de relatórios
// -------------------------------------------------------------
app.get("/relatorios/modelos", (req, res) => {
  return res.json({
    status: "sucesso",
    modelos: MODELOS_RELATORIO,
  });
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
      tipo, // caixinha | corrente | cartao
      nome, // Ex: Nubank
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


function normalizarTexto(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

const MEIOS_EXPENSE = new Set([
  "credito",
  "debito",
  "pix",
  "dinheiro",
  "boleto",
  "transferencia",
  "outro",
]);

const MEIOS_INCOME = new Set([
  "debito",
  "pix",
  "dinheiro",
  "boleto",
  "transferencia",
  "outro",
]);

async function garantirCartaoExiste(uid, cartao) {
  const nomeCartao = cartao.toString().trim();

  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("accounts")
    .where("tipo", "==", "cartao")
    .where("nome", "==", nomeCartao)
    .limit(1)
    .get();

  if (snap.empty) {
    throw new Error(
      `Cartão '${nomeCartao}' não está cadastrado. Cadastre o cartão antes de lançar no crédito.`
    );
  }

  return nomeCartao;
}

async function garantirContaExiste(uid, conta) {
  const nomeConta = conta.toString().trim();

  const snap = await db
    .collection("users")
    .doc(uid)
    .collection("accounts")
    .where("nome", "==", nomeConta)
    .limit(1)
    .get();

  if (snap.empty) {
    throw new Error(
      `Conta '${nomeConta}' não está cadastrada. Cadastre a conta antes de lançar.`
    );
  }

  const dados = snap.docs[0].data() || {};
  if (String(dados.tipo || "").toLowerCase() === "cartao") {
    throw new Error(
      `A conta '${nomeConta}' é do tipo cartão. Para crédito, envie meio='credito' e informe o campo 'cartao'.`
    );
  }

  return nomeConta;
}

app.post("/lancamento", async (req, res) => {
  try {
    console.log("💾 [LANÇAMENTO] Body recebido:", req.body);

    const {
      email,
      tipo,
      meio,
      cartao,
      conta, // obrigatório quando não for crédito
      categoriaId,
      subcategoriaId,
      descricao = "",
      valor,
      data,
      parcelas,
      installments,
    } = req.body;

    const tipoLimpo = normalizarTexto(tipo);
    const meioLimpo = normalizarTexto(meio);
    const emailLimpo = (email ?? "").toString().trim().toLowerCase();

    if (!emailLimpo || !tipoLimpo || !categoriaId || !valor || !data) {
      return res.status(400).json({
        error: "Campos obrigatórios faltando (email, tipo, categoriaId, valor, data).",
      });
    }

    if (tipoLimpo !== "income" && tipoLimpo !== "expense") {
      return res.status(400).json({ error: "tipo deve ser 'income' ou 'expense'." });
    }

    if (!meioLimpo) {
      return res.status(400).json({
        error: "Campo 'meio' é obrigatório (pix, debito, dinheiro, boleto, transferencia, outro; credito só em despesa).",
      });
    }

    if (tipoLimpo === "income") {
      if (!MEIOS_INCOME.has(meioLimpo)) {
        return res.status(400).json({
          error: "Receita não aceita 'credito'. Use: pix, debito, dinheiro, boleto, transferencia ou outro.",
        });
      }
    } else {
      if (!MEIOS_EXPENSE.has(meioLimpo)) {
        return res.status(400).json({
          error: "Meio inválido para despesa. Use: credito, debito, pix, dinheiro, boleto, transferencia ou outro.",
        });
      }
    }

    const dataIso = normalizarData(data);
    if (!dataIso) return res.status(400).json({ error: "Data inválida" });

    const uid = await getUserId(emailLimpo);

    // ✅ Verifica cadastro no Firebase
    let cartaoFinal = null;
    let contaFinal = null;

    if (meioLimpo === "credito") {
      if (tipoLimpo !== "expense") {
        return res.status(400).json({ error: "Crédito só é permitido para despesas." });
      }
      if (!cartao) {
        return res.status(400).json({
          error: "Para meio='credito', informe o campo 'cartao' (nome do cartão).",
        });
      }
      cartaoFinal = await garantirCartaoExiste(uid, cartao);
    } else {
      if (!conta) {
        return res.status(400).json({
          error: "Para meios diferentes de crédito, informe o campo 'conta' (nome da conta cadastrada).",
        });
      }
      contaFinal = await garantirContaExiste(uid, conta);
    }

    const totalValor = Number(valor);
    if (isNaN(totalValor) || totalValor <= 0) {
      return res.status(400).json({ error: "Valor inválido" });
    }

    const nParcelas = Number(parcelas || installments || 1);
    if (isNaN(nParcelas) || nParcelas < 1) {
      return res.status(400).json({ error: "Número de parcelas inválido" });
    }

    if (nParcelas > 1 && meioLimpo !== "credito") {
      return res.status(400).json({
        error: "Parcelamento só é permitido para meio='credito'.",
      });
    }

    const ref = db.collection("users").doc(uid).collection("transactions");
    const grupoParcelas = nParcelas > 1 ? `PARC-${Date.now()}` : "";

    // ------------------------------
    // À vista
    // ------------------------------
    if (nParcelas === 1) {
      const docData = {
        tipo: tipoLimpo,
        meio: meioLimpo,
        cartao: cartaoFinal,
        conta: contaFinal,
        categoriaId,
        subcategoriaId: subcategoriaId || null,
        data: dataIso,
        descricao,
        grupoParcelas,
        numeroParcela: 1,
        parcelado: "nao",
        parcelas: 1,
        valor: totalValor,
      };

      const docRef = await ref.add(docData);

      return res.json({
        status: "sucesso",
        tipoLancamento: "avista",
        docId: docRef.id,
        dados: docData,
      });
    }

    // ------------------------------
    // Parcelado (crédito)
    // ------------------------------
    const valorParcela = totalValor / nParcelas;
    const batch = db.batch();
    const idsParcelas = [];

    const [anoBase, mesBase, diaBase] = dataIso.split("-").map(Number);
    const dataBase = new Date(anoBase, mesBase - 1, diaBase);

    for (let i = 0; i < nParcelas; i++) {
      const d = new Date(dataBase);
      d.setMonth(dataBase.getMonth() + i);
      const dataParcela = d.toISOString().split("T")[0];

      const docRef = ref.doc();
      const docData = {
        tipo: tipoLimpo,
        meio: meioLimpo,
        cartao: cartaoFinal,
        conta: null,
        categoriaId,
        subcategoriaId: subcategoriaId || null,
        data: dataParcela,
        descricao: `${descricao} (parc. ${i + 1}/${nParcelas})`,
        grupoParcelas,
        numeroParcela: i + 1,
        parcelado: "sim",
        parcelas: nParcelas,
        valor: valorParcela,
      };

      batch.set(docRef, docData);
      idsParcelas.push({ id: docRef.id, data: docData });
    }

    await batch.commit();

    return res.json({
      status: "sucesso",
      tipoLancamento: "parcelado",
      parcelasCriadas: nParcelas,
      documentos: idsParcelas.map((p) => ({ id: p.id, data: p.data })),
    });
  } catch (err) {
    console.error("❌ Erro em POST /lancamento:", err);
    return res.status(500).json({ error: err.message });
  }
});


// -------------------------------------------------------------
// 🧾 WEBHOOK - LISTAR CARTÕES DE CRÉDITO CADASTRADOS (por e-mail)
// -------------------------------------------------------------
app.post("/cartoes/listar", async (req, res) => {
  try {
    const { email } = req.body || {};

    if (!email) {
      return res.status(400).json({ error: "Informe 'email' no body." });
    }

    const uid = await getUserId(email.toString().trim().toLowerCase());

    const snap = await db
      .collection("users")
      .doc(uid)
      .collection("accounts")
      .where("tipo", "==", "cartao")
      .get();

    const cartoes = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data() || {};
      cartoes.push({
        id: docSnap.id,
        nome: d.nome || null,
        limite: Number(d.limite || 0),
        fechamento: d.fechamento || null,
        vencimento: d.vencimento || null,
      });
    });

    // ordena por nome
    cartoes.sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));

    return res.json({
      status: "sucesso",
      uid,
      quantidade: cartoes.length,
      cartoes,
      nomes: cartoes.map((c) => c.nome), // ✅ útil pro Nicochat
    });
  } catch (err) {
    console.error("Erro em /cartoes/listar:", err);
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
  console.log("✅ [CONSULTA] Entrou no bloco gasto_periodo");

  const { inicio, fim, meio = "todos", limite = 50 } = req.body;
  console.log("📌 [CONSULTA] Parâmetros recebidos:", { inicio, fim, meio, limite });

  if (!inicio || !fim) {
    console.log("❌ [CONSULTA] Falta inicio ou fim");
    return res.status(400).json({
      error: "Para 'gasto_periodo' informe 'inicio' e 'fim' (YYYY-MM-DD).",
    });
  }

  console.log("🚦 [CONSULTA] Chamando calcularGastoPeriodo...");
  const resultado = await calcularGastoPeriodo(uid, inicio, fim, meio, limite);
  console.log("✅ [CONSULTA] calcularGastoPeriodo retornou. qtd:", resultado?.quantidadeLancamentos);

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
      lancamentos: resultado.lancamentos,
    },
  });
}


if (acao === "receita_periodo") {
  const { inicio, fim, meio = "todos", limite = 50 } = req.body;

  if (!inicio || !fim) {
    return res.status(400).json({
      error: "Para 'receita_periodo' informe 'inicio' e 'fim' (YYYY-MM-DD).",
    });
  }

  const resultado = await calcularReceitaPeriodo(uid, inicio, fim, meio, limite);

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
      lancamentos: resultado.lancamentos, // ✅ lista
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
      snap.forEach((docSnap) => {
        const dados = docSnap.data();
        console.log("🔎 DOC NO PERÍODO (RECEITA):", docSnap.id, dados);
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


const PDFDocument = require("pdfkit");

app.post("/relatorio/pdf", async (req, res) => {
  try {
    // =============================
    // 1) ENTRADAS
    // =============================
    const { uid, mes, email } = req.body || {};
    // mes no formato "YYYY-MM" (ex: "2025-11")

    console.log("📥 /relatorio/pdf body:", req.body);

    if (!uid) {
      return res.status(400).json({ ok: false, error: "Faltou uid" });
    }
    if (!mes || !/^\d{4}-\d{2}$/.test(String(mes))) {
      return res.status(400).json({ ok: false, error: "Faltou mes no formato YYYY-MM (ex: 2025-11)" });
    }

    // =============================
    // 2) BUSCAR TRANSAÇÕES DO USUÁRIO
    // =============================
    // Caminho: users/{uid}/transactions
    const colRef = admin.firestore().collection(`users/${uid}/transactions`);
    const snap = await colRef.get();

    console.log("📦 Total docs encontrados:", snap.size);

    // =============================
    // 3) FILTRAR SÓ O MÊS PEDIDO
    // =============================
    const itensMes = [];
    let totalIncome = 0;
    let totalExpense = 0;

    snap.forEach((doc) => {
      const d = doc.data() || {};
      const data = String(d.data || ""); // "YYYY-MM-DD"
      if (!data.startsWith(mes)) return;

      const tipo = String(d.tipo || "").toLowerCase(); // income | expense
      const valor = Number(d.valor || 0);

      const item = {
        data,
        tipo,
        categoriaId: d.categoriaId || "",
        subcategoriaId: d.subcategoriaId || "",
        descricao: d.descricao || "",
        valor,
      };

      itensMes.push(item);

      if (tipo === "income") totalIncome += valor;
      if (tipo === "expense") totalExpense += valor;
    });

    // Ordena por data (mais recente primeiro)
    itensMes.sort((a, b) => String(b.data).localeCompare(String(a.data)));

    console.log("📅 Itens do mês:", itensMes.length);
    console.log("💰 Totais:", { totalIncome, totalExpense, saldo: totalIncome - totalExpense });

    // =============================
    // 4) GERAR PDF (EM MEMÓRIA)
    // =============================
    const docPdf = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];

    docPdf.on("data", (c) => chunks.push(c));

    const pdfBuffer = await new Promise((resolve, reject) => {
      docPdf.on("end", () => resolve(Buffer.concat(chunks)));
      docPdf.on("error", reject);

      // Cabeçalho
      docPdf.fontSize(18).text("Planilson Financeiro", { align: "left" });
      docPdf.moveDown(0.2);
      docPdf.fontSize(12).text(`Relatório mensal: ${mes}`, { align: "left" });
      if (email) docPdf.fontSize(10).fillColor("gray").text(`Usuário: ${email}`);
      docPdf.fillColor("black");
      docPdf.moveDown(1);

      // Resumo
      docPdf.fontSize(12).text(`Receitas: R$ ${totalIncome.toFixed(2)}`);
      docPdf.text(`Despesas: R$ ${totalExpense.toFixed(2)}`);
      docPdf.text(`Saldo: R$ ${(totalIncome - totalExpense).toFixed(2)}`);
      docPdf.moveDown(1);

      // Linha
      docPdf.moveTo(40, docPdf.y).lineTo(555, docPdf.y).stroke();
      docPdf.moveDown(0.8);

      // Lista (simples e leve)
      docPdf.fontSize(12).text("Lançamentos do mês:", { underline: true });
      docPdf.moveDown(0.5);

      if (!itensMes.length) {
        docPdf.fontSize(11).fillColor("gray").text("Nenhum lançamento encontrado neste mês.");
        docPdf.fillColor("black");
        docPdf.end();
        return;
      }

      docPdf.fontSize(9);

      for (const it of itensMes) {
        const dataBR = it.data ? it.data.split("-").reverse().join("/") : "";
        const tipoPT = it.tipo === "income" ? "Receita" : it.tipo === "expense" ? "Despesa" : it.tipo;

        const linha =
          `${dataBR} | ${tipoPT} | ${it.categoriaId}${it.subcategoriaId ? " / " + it.subcategoriaId : ""} | ` +
          `${it.descricao || ""} | R$ ${Number(it.valor || 0).toFixed(2)}`;

        docPdf.text(linha, { width: 515 });

        // quebra de página se ficar perto do fim
        if (docPdf.y > 760) docPdf.addPage();
      }

      docPdf.end();
    });

    // =============================
    // 5) SUBIR NO FIREBASE STORAGE
    // =============================
    const bucket = admin.storage().bucket();
    const filePath = `relatorios/${uid}/relatorio-${mes}-${Date.now()}.pdf`;
    const file = bucket.file(filePath);

    await file.save(pdfBuffer, {
      contentType: "application/pdf",
      resumable: false,
      metadata: {
        cacheControl: "private, max-age=0, no-transform",
      },
    });

    console.log("☁️ PDF salvo no Storage:", filePath);

    // =============================
    // 6) GERAR URL ASSINADA (PRA BAIXAR)
    // =============================
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 1000 * 60 * 60 * 24, // 24h
    });

    console.log("🔗 URL assinada gerada:", url);

    // =============================
    // 7) RESPOSTA PRO NICOCHAT
    // =============================
    return res.json({
      ok: true,
      mes,
      totalIncome,
      totalExpense,
      saldo: totalIncome - totalExpense,
      quantidadeLancamentos: itensMes.length,
      url,
    });
  } catch (e) {
    console.error("❌ Erro /relatorio/pdf:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// -------------------------------------------------------------
// 🔎 MATCH "SEMÂNTICO" (FUZZY) DE CARTÃO (por e-mail)
// -------------------------------------------------------------

function removerAcentos(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizarNome(s) {
  return removerAcentos(String(s || ""))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // tira pontuação
    .replace(/\s+/g, " ")
    .trim();
}

// Levenshtein distance
function levenshtein(a, b) {
  a = a || "";
  b = b || "";
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function similarityRatio(a, b) {
  const A = normalizarNome(a);
  const B = normalizarNome(b);
  if (!A || !B) return 0;
  if (A === B) return 1;

  const dist = levenshtein(A, B);
  const maxLen = Math.max(A.length, B.length);
  return maxLen === 0 ? 0 : 1 - dist / maxLen; // 0..1
}

function tokenOverlapScore(a, b) {
  const A = normalizarNome(a).split(" ").filter(Boolean);
  const B = normalizarNome(b).split(" ").filter(Boolean);
  if (!A.length || !B.length) return 0;

  const setA = new Set(A);
  const setB = new Set(B);

  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;

  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union; // 0..1
}

function scoreCartao(input, candidato) {
  // mistura: token overlap ajuda quando o usuário escreve só parte do nome
  // levenshtein ajuda quando ele erra letras
  const s1 = tokenOverlapScore(input, candidato);
  const s2 = similarityRatio(input, candidato);
  return 0.55 * s1 + 0.45 * s2; // 0..1
}

app.post("/cartoes/match", async (req, res) => {
  try {
    const { email, cartao_input, limite_sugestoes = 5 } = req.body || {};

    if (!email || !cartao_input) {
      return res.status(400).json({
        error: "Informe 'email' e 'cartao_input' no body.",
      });
    }

    const uid = await getUserId(email.toString().trim().toLowerCase());

    const snap = await db
      .collection("users")
      .doc(uid)
      .collection("accounts")
      .where("tipo", "==", "cartao")
      .get();

    const cartoes = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data() || {};
      if (d.nome) cartoes.push(d.nome);
    });

    if (!cartoes.length) {
      return res.status(404).json({
        status: "falha",
        motivo: "nenhum_cartao_cadastrado",
        mensagem: "Você não tem cartões cadastrados ainda.",
      });
    }

    // calcula scores
    const ranked = cartoes
      .map((nome) => ({
        nome,
        score: scoreCartao(cartao_input, nome),
      }))
      .sort((a, b) => b.score - a.score);

    const melhor = ranked[0];
    const sugestoes = ranked.slice(0, Number(limite_sugestoes) || 5);

    // limiar (ajuste fino):
    // 0.72 costuma pegar "parte do nome" e pequenos erros, sem dar match errado fácil
    const LIMIAR = 0.72;

    if (!melhor || melhor.score < LIMIAR) {
      return res.status(404).json({
        status: "falha",
        motivo: "cartao_nao_encontrado",
        cartao_input,
        mensagem:
          "Este cartão não está cadastrado (ou o nome não bateu). Tente escrever o nome mais próximo do cadastrado.",
        sugestoes: sugestoes.map((s) => ({ nome: s.nome, score: Number(s.score.toFixed(3)) })),
      });
    }

    return res.json({
      status: "sucesso",
      cartao_input,
      cartao_correspondente: melhor.nome, // ✅ nome correto para você usar no /lancamento
      score: Number(melhor.score.toFixed(3)),
      sugestoes: sugestoes.map((s) => ({ nome: s.nome, score: Number(s.score.toFixed(3)) })),
    });
  } catch (err) {
    console.error("Erro em /cartoes/match:", err);
    return res.status(500).json({ error: err.message });
  }
});



// -------------------------------------------------------------
// 🚀 START
// -------------------------------------------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 API rodando na porta", PORT);
});
