const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

const admin = require('firebase-admin');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Inicialização Firebase
try {
    const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS; 
    const projectId = process.env.GCLOUD_PROJECT;
    
    if (!serviceAccountJson || !projectId) {
        throw new Error('As variáveis GOOGLE_APPLICATION_CREDENTIALS ou GCLOUD_PROJECT não estão definidas.');
    }
    
    const tempFilePath = path.join(os.tmpdir(), 'serviceAccountKey.json');
    fs.writeFileSync(tempFilePath, serviceAccountJson);

    const serviceAccount = require(tempFilePath);

    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: projectId
    });

    console.log('Firebase inicializado com sucesso usando arquivo temporário!');
} catch (e) {
    console.error('ERRO CRÍTICO ao inicializar Firebase:', e.message);
    process.exit(1);
}

// FIRESTORE
const db = admin.firestore();
const auth = admin.auth();

// ROTA GET (TESTE)
app.get("/", (req, res) => {
    res.send("Webhook ativo no Railway!");
});

// ROTA POST /webhook (OBRIGATÓRIA)
app.post("/webhook", async (req, res) => {
    console.log("🔔 Webhook recebido!");
    console.log(req.body);

    try {
        return res.status(200).json({
            status: "success",
            received: req.body
        });
    } catch (err) {
        console.error("Erro:", err);
        return res.status(500).json({ error: err.message });
    }
});

// INICIAR SERVIDOR
app.listen(PORT, () => {
    console.log(`🔥 Servidor rodando na porta ${PORT}`);
});
