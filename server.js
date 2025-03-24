import express from 'express';
import cors from 'cors';
import { db, auth } from './firebaseAdmin.js';
import admin from 'firebase-admin';
import { scheduleReminder } from './services/whatsappService.js';
// import twilio from 'twilio';
// import dotenv from 'dotenv';
// dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// const twilioClient = twilio(
//   process.env.TWILIO_ACCOUNT_SID,
//   process.env.TWILIO_AUTH_TOKEN
// );

// Middleware para verificar token de autenticação
const authenticateToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(403).json({ error: 'Token inválido' });
  }
};

// No início das rotas
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  next();
});

app.get('/', (req, res) => {
  res.status(200).json({ message: 'API de listas de compras' });
});

// Rota para buscar todas as listas
app.get('/api/lists', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const listsRef = db.collection('lists');
    const snapshot = await listsRef
      .where('owner', '==', userId)
      .get();

    const lists = [];
    snapshot.forEach(doc => {
      lists.push({ id: doc.id, ...doc.data() });
    });

    res.json(lists);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar listas' });
  }
});

// Rota para criar uma nova lista
app.post('/api/lists', authenticateToken, async (req, res) => {
  try {
    console.log('Criando lista:', req.body);
    console.log('Usuario:', req.user);
    const { name } = req.body;
    const userId = req.user.uid;

    const listRef = await db.collection('lists').add({
      name,
      owner: userId,
      items: [],
      sharedWith: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const newList = await listRef.get();
    res.json({ id: newList.id, ...newList.data() });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar lista' });
  }
});

// Rota para buscar detalhes de uma lista específica
app.get('/api/lists/:listId', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const userId = req.user.uid;

    const listRef = db.collection('lists').doc(listId);
    const list = await listRef.get();

    if (!list.exists) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    const listData = list.data();
    if (listData.owner !== userId && !listData.sharedWith.includes(userId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    res.json({ id: list.id, ...listData });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar detalhes da lista' });
  }
});

// Rota para adicionar item à lista
app.post('/api/lists/:listId/items', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const { name, quantity } = req.body;
    const userId = req.user.uid;

    const listRef = db.collection('lists').doc(listId);
    const list = await listRef.get();

    if (!list.exists) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    const listData = list.data();
    if (listData.owner !== userId && !listData.sharedWith.includes(userId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const newItem = {
      id: Date.now().toString(),
      name,
      quantity,
      completed: false,
      createdAt: new Date().toISOString()
    };

    await listRef.update({
      items: admin.firestore.FieldValue.arrayUnion(newItem)
    });

    res.status(201).json(newItem);
  } catch (error) {
    console.error('Erro ao adicionar item:', error);
    res.status(500).json({ error: 'Erro ao adicionar item' });
  }
});

// Rota para compartilhar lista
app.post('/api/lists/:listId/share', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const { email } = req.body;
    const userId = req.user.uid;

    const userToShare = await auth.getUserByEmail(email);
    const listRef = db.collection('lists').doc(listId);
    const list = await listRef.get();

    if (!list.exists) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    if (list.data().owner !== userId) {
      return res.status(403).json({ error: 'Apenas o dono pode compartilhar a lista' });
    }

    await listRef.update({
      sharedWith: admin.firestore.FieldValue.arrayUnion(userToShare.uid)
    });

    res.json({ message: 'Lista compartilhada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao compartilhar lista' });
  }
});

// Rota para atualizar status do item
app.patch('/api/lists/:listId/items/:itemId', authenticateToken, async (req, res) => {
  try {
    const { listId, itemId } = req.params;
    const { completed } = req.body;
    const userId = req.user.uid;

    const listRef = db.collection('lists').doc(listId);
    const list = await listRef.get();

    if (!list.exists) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    const listData = list.data();
    if (listData.owner !== userId && !listData.sharedWith.includes(userId)) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const updatedItems = listData.items.map(item => 
      item.id === itemId ? { ...item, completed } : item
    );

    await listRef.update({ items: updatedItems });

    res.json({ message: 'Item atualizado com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar item' });
  }
});

// Rota para deletar lista
app.delete('/api/lists/:listId', authenticateToken, async (req, res) => {
  try {
    const { listId } = req.params;
    const userId = req.user.uid;

    const listRef = db.collection('lists').doc(listId);
    const list = await listRef.get();

    if (!list.exists) {
      return res.status(404).json({ error: 'Lista não encontrada' });
    }

    if (list.data().owner !== userId) {
      return res.status(403).json({ error: 'Apenas o dono pode deletar a lista' });
    }

    await listRef.delete();
    res.json({ message: 'Lista deletada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar lista' });
  }
});

// Rota para agendar lembrete
app.post('/api/lists/:listId/items/:itemId/reminder', authenticateToken, async (req, res) => {
  try {
    const { listId, itemId } = req.params;
    const { reminderDate, phoneNumber } = req.body;
    const userId = req.user.uid;

    const listRef = db.collection('lists').doc(listId);
    const list = await listRef.get();
    
    if (!list.exists || (list.data().owner !== userId && !list.data().sharedWith.includes(userId))) {
      return res.status(403).json({ error: 'Acesso negado' });
    }

    const listData = list.data();
    const item = listData.items.find(item => item.id === itemId);

    if (!item) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }

    // Agendar o lembrete
    scheduleReminder(reminderDate, phoneNumber, item.name, listData.name);

    // Salvar os dados do lembrete
    await listRef.update({
      reminders: admin.firestore.FieldValue.arrayUnion({
        itemId,
        reminderDate,
        phoneNumber,
        createdAt: new Date().toISOString()
      })
    });

    res.json({ message: 'Lembrete agendado com sucesso' });
  } catch (error) {
    console.error('Erro ao agendar lembrete:', error);
    res.status(500).json({ error: 'Erro ao agendar lembrete' });
  }
});

// Rota de teste para WhatsApp
app.post('/api/test-whatsapp', authenticateToken, async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    const message = "Teste de integração com WhatsApp! Se você recebeu esta mensagem, a configuração está funcionando corretamente.";
    
    const result = await sendWhatsAppMessage(phoneNumber, message);
    res.json({ success: true, result });
  } catch (error) {
    console.error('Erro no teste do WhatsApp:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data || 'Sem detalhes adicionais'
    });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
}); 