const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

// 2. Inicialização do Firebase Admin SDK (Método Automático)
const admin = require('firebase-admin');

try {
    admin.initializeApp(); 

    console.log('Firebase inicializado com sucesso usando credenciais do ambiente!');
} catch (e) {
    console.error('ERRO CRÍTICO ao inicializar Firebase:', e.message);
    process.exit(1);
}


const db = admin.firestore(); 


app.get('/', (req, res) => {
    res.status(200).send('Servidor ativo. Endpoint POST para dados: /webhook');
});


app.post('/webhook', async (req, res) => {
    const dados = req.body; 

    // Validação básica
    if (!dados || Object.keys(dados).length === 0) {
        return res.status(400).send('Corpo da requisição vazio ou inválido. Esperando dados JSON.');
    }

    try {

        await db.collection('dados_do_nicochat').add({
            ...dados, 
            timestamp: admin.firestore.FieldValue.serverTimestamp() // Adiciona um timestamp do servidor
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
