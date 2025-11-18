const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

const admin = require('firebase-admin');

// 1. Inicialização EXPLÍCITA do Firebase Admin SDK (CORREÇÃO CRÍTICA PARA RAILWAY)
try {
    // Busca credenciais configuradas nas variáveis de ambiente do Railway
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    const projectId = process.env.GCLOUD_PROJECT;
    
    // Verifica se as variáveis críticas estão definidas
    if (!serviceAccountJson || !projectId) {
        throw new Error('As variáveis de ambiente do Firebase (FIREBASE_SERVICE_ACCOUNT e GCLOUD_PROJECT) não estão configuradas ou estão vazias.');
    }

    // O JSON.parse é feito aqui, lendo a variável de ambiente
    const serviceAccount = JSON.parse(serviceAccountJson);
    
    // Inicializa manualmente, usando as credenciais e o ID do projeto passados
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: projectId 
    });
    
    console.log('Firebase inicializado com sucesso e conectado ao projeto ' + projectId);
} catch (e) {
    // Isso é o que causa o "Crashed" se as variáveis não estiverem 100% corretas no Railway
    console.error('ERRO CRÍTICO ao inicializar Firebase:', e.message);
    process.exit(1);
}

// Obtém as referências para os serviços
const db = admin.firestore();
const auth = admin.auth(); 

// ----------------------------------------------------------------------
// --- ROTA 1: CADASTRO/LOGIN (Cria conta na aba Authentication) ---
// ----------------------------------------------------------------------
app.post('/webhook/cadastro', async (req, res) => {
    const dados = req.body;

    // Validação de dados obrigatórios
    if (!dados.email || !dados.password) {
        return res.status(400).send('Requer "email" e "password" no corpo para cadastrar.');
    }

    try {
        // 1. Cria o usuário no Firebase Authentication (UID é gerado)
        const userRecord = await auth.createUser({
            email: dados.email,
            password: dados.password, 
            phoneNumber: dados.telefone || null 
        });

        // 2. Salva os dados adicionais (nome, cpf, etc.) no Firestore
        await db.collection('usuarios').doc(userRecord.uid).set({
            ...dados, // Salva todos os campos extras enviados
            uid: userRecord.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.status(200).send(`Usuário criado no Authentication e dados salvos no Firestore! UID: ${userRecord.uid}`);
    } catch (e) {
        // Trata e-mail já existente
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

        // 1. Encontra o usuário no Firebase Auth (seja por e-mail ou telefone)
        if (identifier.includes('@')) {
            userAuth = await auth.getUserByEmail(identifier);
        } else {
            userAuth = await auth.getUserByPhoneNumber(identifier);
        }

        const userUID = userAuth.uid; 
        
        // 2. Remove o identificador do JSON antes de salvar, isolando só os dados da transação
        const { identificador_usuario, ...lancamento } = dados; 

        // 3. Salva a transação como uma SUBCOLEÇÃO 'transacoes'
        await db
            .collection('usuarios')
            .doc(userUID) // Acessa o usuário específico pelo UID
            .collection('transacoes') 
            .add({
                ...lancamento,
                uid: userUID, // Redundância útil para indexação
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

        res.status(200).send(`Lançamento salvo com sucesso para o usuário ${userAuth.email}.`);
    } catch (e) {
        // Erro 404 se o usuário não for encontrado (e.code 'auth/user-not-found')
        console.error('Erro ao processar lançamento:', e.message);
        res.status(404).send('Erro: O usuário não foi encontrado ou falha de autenticação.');
    }
});


// --- ROTA BASE E LISTEN ---
app.get('/', (req, res) => {
    res.status(200).send('Servidor ativo. Endpoints: /webhook/cadastro e /webhook/lancamento');
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
