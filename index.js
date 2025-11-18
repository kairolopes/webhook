const express = require('express');
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

const admin = require('firebase-admin');

// 1. Inicialização Segura do Firebase Admin SDK
try {
    // Busca credenciais automaticamente nas variáveis de ambiente do Railway
    admin.initializeApp(); 
    console.log('Firebase inicializado com sucesso.');
} catch (e) {
    console.error('ERRO CRÍTICO ao inicializar Firebase:', e.message);
    process.exit(1);
}

// Obtém as referências para os serviços
const db = admin.firestore();
const auth = admin.auth(); 

// --- ROTA 1: CADASTRO/LOGIN (Cria conta e salva dados pessoais) ---
app.post('/webhook/cadastro', async (req, res) => {
    const dados = req.body;

    // Validação mínima para o Firebase Authentication
    if (!dados.email || !dados.password) {
        return res.status(400).send('Requer "email" e "password" no corpo para cadastrar um usuário.');
    }

    try {
        // 1. Cria o usuário no Firebase Authentication (Firebase hash a senha)
        const userRecord = await auth.createUser({
            email: dados.email,
            password: dados.password, 
            phoneNumber: dados.telefone || null // Telefone (opcional)
        });

        // 2. Salva os dados adicionais (nome, telefone, etc.) no Firestore
        await db.collection('usuarios').doc(userRecord.uid).set({
            ...dados, // Salva todos os campos extras enviados
            uid: userRecord.uid,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.status(200).send(`Usuário criado no Authentication e dados salvos no Firestore! UID: ${userRecord.uid}`);
    } catch (e) {
        if (e.code === 'auth/email-already-exists') {
             return res.status(409).send('Erro: Este e-mail já está em uso.');
        }
        console.error('Erro ao criar usuário:', e.message);
        res.status(500).send(`Erro interno ao processar cadastro: ${e.message}`);
    }
});


// --- ROTA 2: LANÇAMENTOS/DESPESAS (Atrela a transação ao UID do usuário) ---
app.post('/webhook/lancamento', async (req, res) => {
    const dados = req.body;

    // Requer um identificador para saber quem está lançando, e o valor
    if (!dados.identificador_usuario || !dados.valor) {
        return res.status(400).send('Dados inválidos. Requer "identificador_usuario" (email/telefone) e "valor".');
    }

    try {
        let userAuth;
        const identifier = dados.identificador_usuario;

        // 1. Encontra o usuário no Firebase Auth pelo e-mail ou telefone
        if (identifier.includes('@')) {
            userAuth = await auth.getUserByEmail(identifier);
        } else {
            userAuth = await auth.getUserByPhoneNumber(identifier);
        }

        const userUID = userAuth.uid; 
        
        // 2. Remove o identificador do JSON antes de salvar
        const { identificador_usuario, ...lancamento } = dados; 

        // 3. Salva a transação como uma SUBCOLEÇÃO (transacoes) do documento do usuário
        await db
            .collection('usuarios')
            .doc(userUID) // Acessa o usuário específico pelo UID
            .collection('transacoes') 
            .add({
                ...lancamento,
                uid: userUID, // Adiciona o UID na transação para maior flexibilidade
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

        res.status(200).send(`Lançamento salvo com sucesso para o usuário ${userAuth.email}.`);
    } catch (e) {
        // Erro 404 se o usuário não for encontrado ou outro erro de autenticação
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
