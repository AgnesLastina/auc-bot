require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const auctionHandler = require('./handlers/auctionHandler');

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB подключена ✅');
    startBot();
  })
  .catch(err => console.log(err));

function startBot() {

  const bot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: true
  });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      'Привет 🤖\n\n/auction — создать аукцион'
    );
  });

  auctionHandler(bot);

  bot.on('polling_error', console.log);

  console.log('Бот запущен 🤖');
}