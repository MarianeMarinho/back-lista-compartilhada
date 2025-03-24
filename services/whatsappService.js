import axios from 'axios';
import schedule from 'node-schedule';
import dotenv from 'dotenv';
import { db } from '../firebaseAdmin.js';

dotenv.config();

const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

const validatePhoneNumber = (phoneNumber) => {
  // Regex para validar número no formato internacional (+55DDDNUMERO)
  const phoneRegex = /^\+[1-9]\d{1,14}$/;
  if (!phoneRegex.test(phoneNumber)) {
    throw new Error('Número de telefone inválido. Use o formato internacional (+55DDDNUMERO)');
  }
};

const saveReminderToDatabase = async (reminderData) => {
  try {
    const reminderRef = await db.collection('reminders').add({
      ...reminderData,
      createdAt: new Date().toISOString(),
      status: 'scheduled'
    });
    return reminderRef.id;
  } catch (error) {
    console.error('Erro ao salvar lembrete no banco:', error);
    throw new Error('Falha ao salvar lembrete no banco de dados');
  }
};

const sendWhatsAppMessage = async (to, message) => {
  try {
    validatePhoneNumber(to);
    
    const response = await axios.post(
      `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Erro ao enviar mensagem WhatsApp:', error);
    if (error.response?.data) {
      throw new Error(`Erro WhatsApp: ${error.response.data.error.message}`);
    }
    throw error;
  }
};

const scheduleReminder = async (reminderDate, phoneNumber, itemName, listName) => {
  try {
    // Validar número de telefone
    validatePhoneNumber(phoneNumber);

    // Salvar lembrete no banco
    const reminderData = {
      phoneNumber,
      itemName,
      listName,
      scheduledFor: reminderDate,
    };
    
    const reminderId = await saveReminderToDatabase(reminderData);

    // Agendar o envio
    schedule.scheduleJob(new Date(reminderDate), async () => {
      const message = `Lembrete: Você precisa comprar "${itemName}" da sua lista "${listName}"!`;
      try {
        await sendWhatsAppMessage(phoneNumber, message);
        // Atualizar status do lembrete
        await db.collection('reminders').doc(reminderId).update({
          status: 'sent',
          sentAt: new Date().toISOString()
        });
      } catch (error) {
        console.error('Erro ao enviar lembrete:', error);
        await db.collection('reminders').doc(reminderId).update({
          status: 'failed',
          error: error.message
        });
      }
    });

    return reminderId;
  } catch (error) {
    console.error('Erro ao agendar lembrete:', error);
    throw error;
  }
};

export { sendWhatsAppMessage, scheduleReminder }; 