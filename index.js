const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

const admin = require('firebase-admin');

// 1. INICIALIZAÇÃO EXPLÍCITA (FINAL FIX para Railway)
try {
    // 💡 LENDO A VARIÁVEL PADRÃO DO GOOGLE (Para contornar o erro de formatação)
    const serviceAccountJson = process.env.GOOGLE_APPLICATION_CREDENTIALS; 
    const projectId = process.env.GCLOUD_PROJECT;
    
    // Verificação de segurança
    if (!serviceAccountJson || !projectId) {
        throw new Error('As variáveis GOOGLE_APPLICATION_CREDENTIALS ou GCLOUD_PROJECT não estão definidas.');
    }

    // JSON.parse é obrigatório aqui, lendo a string
    const serviceAccount = JSON.parse(serviceAccountJson);
    
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount), 
        projectId: projectId 
    });
    
    console.log('Firebase inicializado com sucesso no Railway.');
} catch (e) {
    // Isso deve parar de acontecer após a troca do nome da variável
    console.error('ERRO CRÍTICO ao inicializar Firebase:', e.message);
    process.exit(1);
}

// Obtém as referências para os serviços
const db = admin.firestore();
const auth = admin.auth(); 

// ----------------------------------------------------------------------
// --- ROTA 1: CADASTRO/LOGIN (Cria conta e salva dados pessoais) ---
// ----------------------------------------------------------------------
app.post('/webhook/cadastro', async (req, res) => {
    const dados = req.body;

    if (!dados.email || !dados.password) {
        return res.status(400).send('Requer "email" e "password" no corpo para cadastrar.');
    }

    try {
        // 1. Cria o usuário no Firebase Authentication (Aparece na aba Users)
        const userRecord = await auth.createUser({
            email: dados.email,
            password: dados.password, 
            phoneNumber: dados.telefone || null 
        });

        // 2. Salva os dados adicionais (nome, telefone, cpf, etc.) no Firestore
        await db.collection('usuarios').doc(userRecord.uid).set({
            ...dados, 
            uid: userRecord.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.status(200).send(`Usuário criado no Authentication e dados salvos no Firestore! UID: ${userRecord.uid}`);
    } catch (e) {
        if (e.code === 'auth/email-already-exists') {
             return res.status(409).send('Erro: Este e-mail já está em uso.');
        }
        console.error('Erro ao criar usuário:', e.message);
        res.status(500).send(`Erro interno: ${e.message}`);
    }
});


// ----------------------------------------------------------------------
// --- ROTA 2: LANÇAMENTOS/DESPESAS (Atrela a transação ao UID do usuário) ---
// ----------------------------------------------------------------------
app.post('/webhook/lancamento', async (req, res) => {
    const dados = req.body;

    // Requer o identificador (e-mail ou telefone) e o valor da transação
    if (!dados.identificador_usuario || !dados.valor) {
        return res.status(400).send('Dados inválidos. Requer "identificador_usuario" (email/telefone) e "valor".');
    }

    try {
        let userAuth;
        const identifier = dados.identificador_usuario;

        // 1. Encontra o usuário no Firebase Auth
        if (identifier.includes('@')) {
            userAuth = await auth.getUserByEmail(identifier);
        } else {
            userAuth = await auth.getUserByPhoneNumber(identifier);
        }

        const userUID = userAuth.uid; 
        
        // 2. Remove o identificador do JSON antes de salvar
        const { identificador_usuario, ...lancamento } = dados; 

        // 3. Salva a transação como uma SUBCOLEÇÃO 'transacoes' (Ligação forte)
        await db
            .collection('usuarios')
            .doc(userUID) 
            .collection('transacoes') 
            .add({
                ...lancamento,
                uid: userUID, 
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

        res.status(200).send(`Lançamento salvo com sucesso para o usuário ${userAuth.email}.`);
    } catch (e) {
        // Erro 404 se o usuário não for encontrado
        console.error('Erro ao processar lançamento:', e.message);
        res.status(404).send('Erro: O usuário não foi encontrado ou falha de autenticação.');
    }
});


// --- ROTA BASE E LISTEN ---
app.get('/', (req, res) => {
    res.status(200).send('Servidor ativo no Railway. Endpoints: /webhook/cadastro e /webhook/lancamento');
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
