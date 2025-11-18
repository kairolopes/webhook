// 1. Configuração Básica do Servidor
const express = require('express');
const app = express();
// O Railway define a porta onde o servidor deve rodar (process.env.PORT)
const PORT = process.env.PORT || 3000; 

// Adiciona um "middleware" para que o servidor consiga ler o JSON enviado pelo Nicochat
app.use(express.json()); 

// 2. Configuração do Firebase Admin
const admin = require('firebase-admin');

// Tenta inicializar o Firebase Admin SDK
try { 
    admin.initializeApp({
        // Tenta usar a variável de ambiente GOOGLE_APPLICATION_CREDENTIALS
        credential: admin.credential.applicationDefault()
    });
    console.log('2. Firebase Admin SDK inicializado com sucesso!'); // Log de sucesso
} catch (e) {
    // Se falhar (quase certeza por causa da variável GOOGLE_APPLICATION_CREDENTIALS)
    console.error('2. ERRO FATAL: Falha ao inicializar o Firebase Admin:', e.message); // Log do erro
    // Encerra o processo, pois o servidor não pode salvar dados sem o Firebase
    process.exit(1); 
}

const db = admin.firestore();

// --- NOVO CÓDIGO A SER ADICIONADO AQUI ---

// NOVO ENDPOINT: Rota GET para a URL raiz (/)
// Isso resolve o erro 'Cannot GET /'
app.get('/', (req, res) => {
    // Retorna uma mensagem simples para confirmar que o servidor está rodando
    res.status(200).send('Servidor do Webhook está ativo. Endpoint POST: /webhook');
});

// --- FIM DO NOVO CÓDIGO ---

// 3. O Endpoint do Seu Webhook (A URL POST)
// Esta função será ativada quando o Nicochat fizer um POST para /webhook
app.post('/webhook', async (req, res) => {
    // Verifica se o método é POST (boa prática)
    if (req.method !== 'POST') {
        // Envia um erro se tentarem usar GET ou outro método
        return res.status(405).send('Método não permitido. Use POST.');
    }

    // Pega os dados JSON que vieram no corpo da requisição do Nicochat
    const dadosRecebidos = req.body;
    
    // Define o nome da coleção no seu Firestore (você pode mudar se quiser)
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
        // Se houver erro, loga e envia um código de erro 500
        console.error('Erro ao salvar no Firestore:', error);
        res.status(500).send('Erro interno ao processar o webhook.');
    }
});

// 4. Inicia o Servidor e fica ouvindo a porta que o Railway forneceu
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}. Endpoint: /webhook`);
});
