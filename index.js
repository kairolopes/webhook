const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

const admin = require('firebase-admin');

const admin = require('firebase-admin');

try {
    admin.initializeApp(); // Se a variável ADC estiver correta, ele funciona
    
     const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    
    admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccountJson))
    });

    console.log('Firebase inicializado com sucesso!');
} catch (e) {
 
}

const db = admin.firestore();

app.get('/', (req, res) => {
    res.status(200).send('Servidor ativo. Endpoint POST: /webhook');
});

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
