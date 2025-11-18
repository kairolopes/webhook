// 1. Configuração Básica do Servidor
const express = require('express');
const app = express();
// O Railway define a porta onde o servidor deve rodar (process.env.PORT)
const PORT = process.env.PORT || 3000; 

// Adiciona um "middleware" para que o servidor consiga ler o JSON enviado pelo Nicochat
app.use(express.json()); 

// 2. Configuração do Firebase Admin (Método Explícito e Robusto)
const admin = require('firebase-admin');

try {
    // 1. Acessa o JSON da chave de serviço da variável de ambiente
    const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    
    if (!serviceAccountJson) {
        // Este erro será exibido nos logs do Railway se a variável estiver ausente ou vazia.
        throw new Error('Variável GOOGLE_APPLICATION_CREDENTIALS não está definida/vazia. Verifique a variável de ambiente no Railway.');
    }

    // 2. Faz o parse do JSON para um objeto JavaScript. 
    // Isso pode falhar se o JSON não estiver em linha única (sem \n) no Railway.
    const serviceAccount = JSON.parse(serviceAccountJson);

    // 3. Inicializa o Firebase explicitamente com o certificado.
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('2. Firebase Admin SDK inicializado com sucesso (Método Explícito)!');
} catch (e) {
    console.error('2. ERRO FATAL: Falha na inicialização explícita do Firebase Admin:', e.message);
    // O servidor é encerrado se o Firebase não puder ser inicializado, pois a funcionalidade principal falhou.
    process.exit(1); 
}

const db = admin.firestore();

---

// 3. Rota GET de Verificação
// Esta rota permite verificar se o servidor está ativo (resolve o erro "Cannot GET /").
app.get('/', (req, res) => {
    res.status(200).send('Servidor do Webhook está ativo. Endpoint POST: /webhook');
});

---

// 4. O Endpoint do Seu Webhook (A URL POST)
// Esta função será ativada quando o Nicochat fizer um POST para /webhook
app.post('/webhook', async (req, res) => {
    // Verifica se o método é POST (boa prática, embora a rota já exija)
    if (req.method !== 'POST') {
        return res.status(405).send('Método não permitido. Use POST.');
    }

    // Pega os dados JSON que vieram no corpo da requisição do Nicochat
    const dadosRecebidos = req.body;
    
    // Define o nome da coleção no seu Firestore
    const colecao = 'dados_do_nicochat'; 

    try {
        // Salva os dados no Firestore, criando um documento novo
        await db.collection(colecao).add({
            ...dadosRecebidos, // Pega todos os dados do Nicochat
            timestamp: admin.firestore.FieldValue.serverTimestamp() // Adiciona data/hora do servidor
        });
        
        // Envia uma resposta de sucesso (código 200) de volta para o Nicochat
        res.status(200).send('Dados salvos no Firestore com sucesso!');

    } catch (error) {
        // Se houver erro (ex: falha de conexão, permissão), loga e envia um código de erro 500
        console.error('Erro ao salvar no Firestore:', error);
        res.status(500).send('Erro interno ao processar o webhook.');
    }
});

// 5. Inicia o Servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}. Endpoint: /webhook`);
});
