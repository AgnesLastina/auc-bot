require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const auctionHandler = require('./handlers/auctionHandler');

// =========================
// 🚀 CONNECT DB FIRST
// =========================
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB подключена ✅');

    startBot();
  })
  .catch(err => {
    console.log('Ошибка MongoDB:', err);
  });


// =========================
// 🤖 START BOT
// =========================
function startBot() {

  const bot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: true
  });

  // =========================
  // 🧠 SAFE /START
  // =========================
  bot.onText(/\/start/, async (msg) => {
    try {
      await bot.sendMessage(
        msg.chat.id,
        'Привет! Я бот для создания аукционов 🤖\n\nНапиши /auction чтобы начать.'
      );
    } catch (err) {
      console.log('START ERROR:', err);
    }
  });

  // =========================
  // 📦 PLUG AUCTION SYSTEM
  // =========================
  auctionHandler(bot);

  // =========================
  // 🛡 GLOBAL SAFETY CATCH
  // =========================
  bot.on('polling_error', (err) => {
    console.log('Polling error:', err.code);
  });

  console.log('Бот запущен 🤖');
}