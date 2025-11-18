const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

const admin = require('firebase-admin');

try {
    const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!serviceAccountJson) {
        throw new Error('Variável GOOGLE_APPLICATION_CREDENTIALS não está definida/vazia.');
    }

    const serviceAccount = JSON.parse(serviceAccountJson);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });

    console.log('Firebase inicializado com sucesso!');
} catch (e) {
    console.error('ERRO ao inicializar Firebase:', e.message);
    process.exit(1);
}

const db = admin.firestore();

// GET de teste
app.get('/', (req, res) => {
    res.status(200).send('Servidor ativo. Endpoint POST: /webhook');
});

// POST do webhook
app.post('/webhook', async (req, res) => {
    const dados = req.body;

    try {
        await db.collection('dados_do_nicochat').add({
            ...dados,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.status(200).send('Dados salvos no Firestore!');
    } catch (e) {
        console.error('Erro Firestore:', e);
        res.status(500).send('Erro ao salvar no Firestore.');
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
