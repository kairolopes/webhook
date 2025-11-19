const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

const admin = require('firebase-admin');
const fs = require('fs');       // Módulo para manipular arquivos
const os = require('os');       // Módulo para diretórios temporários
const path = require('path');   // Módulo para caminhos de arquivo

// 1. INICIALIZAÇÃO EXPLÍCITA (FINAL FIX para Leitura de String)
try {
    const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS; 
    const projectId = process.env.GCLOUD_PROJECT;
    
    if (!serviceAccountJson || !projectId) {
        throw new Error('As variáveis GOOGLE_APPLICATION_CREDENTIALS ou GCLOUD_PROJECT não estão definidas.');
    }
    
    // 💡 TÁTICA FINAL: SALVAR O JSON TEMPORARIAMENTE COMO UM ARQUIVO
    // 1. Define um caminho temporário no servidor Railway
    const tempFilePath = path.join(os.tmpdir(), 'serviceAccountKey.json');
    
    // 2. Escreve a string JSON (que está quebrada) no disco como um arquivo real
    fs.writeFileSync(tempFilePath, serviceAccountJson); 

    // 3. Inicializa o Firebase LENDO o arquivo temporário (Forma nativa do Node)
    // O Node.js é muito bom em ler arquivos, mesmo que a string estivesse quebrada.
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

const db = admin.firestore();
const auth = admin.auth(); 
// ... (O restante das Rotas /cadastro e /lancamento)
