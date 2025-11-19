// -------------------------------------------------------------
// 🚀 Servidor Webhook + Firebase Firestore + Autenticação (Versão 2.1 - FINAL)
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
 * Busca o UID do usuário APENAS pelo e-mail (para robustez do webhook).
 * @param {string} email
 * @returns {string} userId
 */
async function getUserId(email) { 
    const snapshot = await db.collection("users")
        .where("email", "==", email)
        .get(); 

    if (snapshot.empty) {
        // Se a busca por e-mail falhar, o usuário não existe.
        throw new Error("Usuário não encontrado.");
    }
    
    return snapshot.docs[0].id;
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
// 4. 🧑‍💼 CADASTRO DE USUÁRIO
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
// 5. 💸 LANÇAMENTO FINANCEIRO (INSERÇÃO - COM BUSCA REAL DE CONTA E PARCELAMENTO)
// -------------------------------------------------------------

app.post("/lancamento", async (req, res) => {
    try {
        const {
            email,
            telefone, // Mantido apenas para a validação 400
            tipo,
            contaId,
            categoriaId,
            subcategoria,
            descricao,
            valor,
            data,
            installments = 1
        } = req.body;

        // Validação de campos obrigatórios
        if (!email || !telefone || !tipo || !valor || !contaId || !categoriaId || !data) {
            return res.status(400).json({ error: "Campos obrigatórios faltando: email, telefone, tipo, valor, contaId, categoriaId, data." });
        }

        // 1. BUSCA O UID (Apenas com o email)
        const userId = await getUserId(email);

        // 2. BUSCA REAL DOS DETALHES DA CONTA NO FIRESTORE
        const accountDoc = await db.collection("users").doc(userId)
                                   .collection("accounts").doc(contaId).get();

        if (!accountDoc.exists) {
             return res.status(404).json({ error: "Erro no lançamento.", details: "Conta/Cartão não encontrado para este usuário." });
        }
        
        const accountData = accountDoc.data();

        const isCreditCard = accountData.type === 'credito' && tipo === 'expense';
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
            
            // Converte os dias de vencimento/fechamento para números (pode ser string no Firestore)
            const dueDay = accountData.dueDay ? parseInt(accountData.dueDay) : 10;
            const closingDay = accountData.closingDay ? parseInt(accountData.closingDay) : 25;

            for (let i = 0; i < numInstallments; i++) {
                
                let finalMonth = purchaseDate.getMonth();
                let finalYear = purchaseDate.getFullYear();

                // Lógica de avanço de mês (Ajuste para a primeira parcela)
                if (i === 0 && purchaseDate.getDate() > closingDay) {
                    finalMonth += 1; 
                }
                
                // Avança o mês e corrige o ano
                finalMonth += i; 

                if (finalMonth > 11) {
                    finalYear += Math.floor(finalMonth / 12);
                    finalMonth = finalMonth % 12;
                }

                // Cria a data de vencimento
                const finalDate = new Date(finalYear, finalMonth, dueDay);

                transacoesParaAdicionar.push({
                    ...baseData,
                    amount: amountPerInstallment,
                    descricao: `${baseData.descricao} (${i + 1}/${numInstallments})`,
                    data: finalDate.toISOString().substring(0, 10),
                    isInstallment: true,
                });
            }
        } else {
            transacoesParaAdicionar.push(baseData);
        }

        // Registrar todas as transações (Batch)
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

// -------------------------------------------------------------
// 6. 🔄 ALTERAÇÃO (UPDATE) DE LANÇAMENTO
// -------------------------------------------------------------

app.put("/lancamento/:transactionId", async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { email, telefone, ...updatedFields } = req.body;

        if (!email || !telefone || Object.keys(updatedFields).length === 0) {
            return res.status(400).json({ error: "Email, telefone e dados de atualização são obrigatórios." });
        }

        const userId = await getUserId(email); // CORRIGIDO

        const transactionRef = db.collection("users")
            .doc(userId)
            .collection("transactions")
            .doc(transactionId);

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

app.delete("/lancamento/:transactionId", async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { email, telefone } = req.body; // Usa BODY para segurança

        if (!email || !telefone) {
            return res.status(400).json({ error: "Email e telefone são obrigatórios para autenticação." });
        }

        const userId = await getUserId(email); // CORRIGIDO

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
        // Trata a exceção de Usuário não encontrado, que é a mais comum
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
// 8. 📊 RELATÓRIO FINANCEIRO (CONSULTA)
// -------------------------------------------------------------

app.post("/relatorio", async (req, res) => {
    try {
        const { email, telefone } = req.body;

        const userId = await getUserId(email); // CORRIGIDO

        const lancamentos = await db.collection("users")
            .doc(userId)
            .collection("transactions")
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
