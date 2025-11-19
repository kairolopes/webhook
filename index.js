// -------------------------------------------------------------
// 🚀 Servidor Webhook + Firebase Firestore + Autenticação (Versão 2.0 - CRUD COMPLETO)
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
// FUNÇÕES AUXILIARES PARA MANTER A CONSISTÊNCIA DE DADOS
// -------------------------------------------------------------

/**
 * Busca o UID do usuário pelo e-mail e verifica o telefone (para robustez).
 * @param {string} email
 * @param {string} telefone
 * @returns {string} userId
 */
async function getUserId(email, telefone) {
    // 1. Busca APENAS pelo E-mail
    const snapshot = await db.collection("users")
        .where("email", "==", email)
        .get();

    if (snapshot.empty) {
        throw new Error("Usuário não encontrado.");
    }
    
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    const userId = userDoc.id;

    // 2. Verifica o Telefone (Garante que o telefone corresponde, mas ignora formatação como '+')
    // Normaliza os valores removendo espaços e caracteres não-numéricos
    const cleanSentPhone = telefone.replace(/\D/g, ''); // Telefone enviado (JSON)
    const cleanStoredPhone = userData.telefone.replace(/\D/g, ''); // Telefone no Firestore

    if (cleanSentPhone !== cleanStoredPhone) {
        // Se o telefone não for idêntico após limpeza, ainda é um erro de credencial
        throw new Error("Telefone incorreto.");
    }

    return userId;
}
async function getAccountDetails(userId, accountId) {
    // Para simplificar, assumimos que 'contaId' contém o tipo (ex: 'credito-nubank')
    // Na prática, buscaríamos na subcoleção 'accounts' do usuário.
    if (accountId && accountId.includes("credito")) {
        // Valores padrão para lógica de cartão (dia 10 vence, dia 25 fecha)
        return { type: 'credito', dueDay: 10, closingDay: 25 };
    }
    return { type: 'conta', dueDay: 0, closingDay: 0 };
}


// -------------------------------------------------------------
// 2. 🌐 ROTA DE TESTE & 3. 🤖 ROTA WEBHOOK GERAL
// -------------------------------------------------------------

app.get("/", (req, res) => {
    res.send("Webhook ativo no Railway!");
});

app.post("/webhook", (req, res) => {
    return res.json({
        status: "success",
        received: req.body
    });
});

// -------------------------------------------------------------
// 4. 🧑‍💼 CADASTRO DE USUÁRIO (MANTIDO)
// -------------------------------------------------------------
app.post("/cadastro", async (req, res) => {
    try {
        const { email, password, nome, telefone, cpf } = req.body;

        if (!email || !password || !telefone) {
            return res.status(400).json({ error: "Campos obrigatórios faltando." });
        }

        // 1. VERIFICAÇÃO MÍNIMA
        if (password.length < 6) {
            return res.status(400).json({ error: "A senha deve ter no mínimo 6 caracteres." });
        }

        // 2. CRIAÇÃO NO AUTH COM TRATAMENTO DE ERRO
        let userRecord;
        try {
            userRecord = await auth.createUser({ email, password });
        } catch (authError) {
            if (authError.code === 'auth/email-already-in-use') {
                 return res.status(409).json({ error: "O email já está cadastrado no Firebase Auth." });
            }
            throw authError; 
        }

        // 3. SALVAR NO FIRESTORE
        await db.collection("users").doc(userRecord.uid).set({
            email, nome, telefone, cpf, criadoEm: new Date()
        });

        return res.json({
            status: "sucesso",
            mensagem: "Usuário cadastrado e autenticado!",
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
// 5. 💸 LANÇAMENTO FINANCEIRO (INSERÇÃO - COM LÓGICA DE PARCELAMENTO)
// -------------------------------------------------------------

app.post("/lancamento", async (req, res) => {
    try {
        const {
            email,
            telefone,
            tipo,
            contaId,       // Novo campo obrigatório
            categoriaId,   // Novo campo
            subcategoria,  // Novo campo
            descricao,
            valor,
            data,
            installments = 1 // Novo campo para parcelas
        } = req.body;

        if (!email || !telefone || !tipo || !valor || !contaId || !categoriaId || !data) {
            return res.status(400).json({ error: "Campos obrigatórios faltando: email, telefone, tipo, valor, contaId, categoriaId, data." });
        }

        const userId = await getUserId(email, telefone);
        const account = await getAccountDetails(userId, contaId);
        const isCreditCard = account.type === 'credito' && tipo === 'expense';
        const numInstallments = parseInt(installments);
        
        let transacoesParaAdicionar = [];
        const baseData = {
            tipo,
            contaId,
            categoriaId,
            subcategoria: subcategoria || "",
            descricao,
            valor: Number(valor),
            data: data, // string YYYY-MM-DD
            criadoEm: new Date(),
            installments: numInstallments,
        };

        // Lógica de Parcelamento (replicada do Frontend)
        if (isCreditCard && numInstallments > 1) {
            const amountPerInstallment = baseData.valor / numInstallments;
            const purchaseDate = new Date(data);

            for (let i = 0; i < numInstallments; i++) {
                let finalDate = new Date(data); // Inicia com a data da compra
                finalDate.setDate(account.dueDay); // Define o dia de vencimento

                let finalMonth = purchaseDate.getMonth() + i;
                let finalYear = purchaseDate.getFullYear();

                // Lógica de avanço de mês: 
                // A primeira parcela pode pular um mês se a compra foi depois do fechamento.
                if (i === 0 && purchaseDate.getDate() > account.closingDay) {
                    finalMonth += 1; 
                }
                
                // Avança o mês e corrige o ano
                finalMonth += i; 

                if (finalMonth > 11) {
                    finalYear += Math.floor(finalMonth / 12);
                    finalMonth = finalMonth % 12;
                }

                finalDate.setFullYear(finalYear, finalMonth, account.dueDay);

                transacoesParaAdicionar.push({
                    ...baseData,
                    amount: amountPerInstallment,
                    descricao: `${baseData.descricao} (${i + 1}/${numInstallments})`,
                    data: finalDate.toISOString().substring(0, 10),
                    isInstallment: true,
                });
            }
        } else {
            // Lançamento único (ou despesa em dinheiro/conta)
            transacoesParaAdicionar.push(baseData);
        }

        // Registrar todas as transações
        const batch = db.batch();
        const transactionsColRef = db.collection("users").doc(userId).collection("transactions");
        
        transacoesParaAdicionar.forEach(t => {
            batch.set(transactionsColRef.doc(), t);
        });

        await batch.commit();

        return res.json({
            status: "sucesso",
            mensagem: `${transacoesParaAdicionar.length} Lançamento(s) registrado(s).`,
            userId
        });

    } catch (error) {
        return res.status(500).json({
            error: "Erro no lançamento.",
            details: error.message
        });
    }
});

// --- NOVAS ROTAS PARA PERMITIR ALTERAÇÃO E EXCLUSÃO (CRUD COMPLETO) ---

// -------------------------------------------------------------
// 6. 🔄 ALTERAÇÃO (UPDATE) DE LANÇAMENTO
// -------------------------------------------------------------

/**
 * Permite alterar qualquer campo de uma transação específica.
 * Rota: PUT /lancamento/T6Bf9L...
 * Corpo: { email: "user@x.com", telefone: "119999", valor: 50.00, descricao: "Novo item" }
 */
app.put("/lancamento/:transactionId", async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { email, telefone, ...updatedFields } = req.body;

        if (!email || !telefone || Object.keys(updatedFields).length === 0) {
            return res.status(400).json({ error: "Email, telefone e dados de atualização são obrigatórios." });
        }

        const userId = await getUserId(email, telefone);

        const transactionRef = db.collection("users")
            .doc(userId)
            .collection("transactions")
            .doc(transactionId);

        // O Admin SDK usa set() com merge: true para atualizar o documento.
        await transactionRef.set(updatedFields, { merge: true });

        return res.json({
            status: "sucesso",
            mensagem: `Lançamento ${transactionId} atualizado.`,
        });
    } catch (error) {
        return res.status(500).json({
            error: "Erro ao atualizar lançamento.",
            details: error.message
        });
    }
});


// -------------------------------------------------------------
// 7. 🗑️ EXCLUSÃO (DELETE) DE LANÇAMENTO
// -------------------------------------------------------------

/**
 * Permite excluir um lançamento específico.
 * Rota: DELETE /lancamento/T6Bf9L...
 * Corpo: { email: "user@x.com", telefone: "119999" }
 */
app.delete("/lancamento/:transactionId", async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { email, telefone } = req.body; // Usa BODY para segurança (evita passar dados sensíveis na URL)

        if (!email || !telefone) {
            return res.status(400).json({ error: "Email e telefone são obrigatórios para autenticação." });
        }

        const userId = await getUserId(email, telefone);

        const transactionRef = db.collection("users")
            .doc(userId)
            .collection("transactions")
            .doc(transactionId);

        await transactionRef.delete();

        return res.json({
            status: "sucesso",
            mensagem: `Lançamento ${transactionId} excluído.`,
        });
    } catch (error) {
        // Retorna 404 se o documento não existir, 500 para outros erros
        if (error.message.includes("Usuário não encontrado")) {
             return res.status(401).json({ error: error.message });
        }
        return res.status(500).json({
            error: "Erro ao excluir lançamento.",
            details: error.message
        });
    }
});

// -------------------------------------------------------------
// 8. 📊 RELATÓRIO FINANCEIRO (CONSULTA - MANTIDO, REORDENADO)
// -------------------------------------------------------------

app.post("/relatorio", async (req, res) => {
    try {
        const { email, telefone } = req.body;

        const userId = await getUserId(email, telefone);

        const lancamentos = await db.collection("users")
            .doc(userId)
            .collection("transactions") // Usando 'transactions' para consistência com o HTML
            .orderBy("data", "desc")
            .get();

        const lista = lancamentos.docs.map(doc => ({ 
             id: doc.id, 
             ...doc.data() 
        }));

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
// 9. 🚀 INICIAR SERVIDOR
// -------------------------------------------------------------

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
