const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const admin = require('firebase-admin');

try {
    const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!serviceAccountJson) {
        throw new Error('Variável GOOGLE_APPLICATION_CREDENTIALS não está definida/vazia. Verifique no Railway.');
    }

    const serviceAccount = JSON.parse(serviceAccountJson);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log('Firebase inicializado com sucesso!');
} catch (e) {
    console.error('ERRO FATAL ao inicializar Firebase:', e.message);
    process.exit(1);
}

const db = admin.firestore();

// GET para teste
app.get('/', (req, res) => {
    res.status(200).send('Servidor do Webhook está ativo. Endpoint POST: /webhook');
});

// Endpoint do webhook
app.post('/webhook', async (req, res) => {
    const dadosRecebidos = req.body;
    const colecao = 'dados_do_nicochat';

    try {
        await db.collection(colecao).add({
            ...dadosRecebidos,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(200).send('Dados salvos no Firestore com sucesso!');
    } catch (error) {
        console.error('Erro ao salvar no Firestore:', error);
        res.status(500).send('Erro interno ao processar o webhook.');
    }
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}. Endpoint: /webhook`);
});
