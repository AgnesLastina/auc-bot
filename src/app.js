require('dotenv').config();

const { connectDB } = require('./db/mongo');
const { launchBot } = require('./bot/bot');

class App {
  async start() {
    try {
      console.log('🚀 Starting application...');

      await connectDB();   // ✅ теперь это функция
      await launchBot();   // запускаем бота

      console.log('✅ Application started successfully');
    } catch (err) {
      console.error('❌ App start error:', err);
      process.exit(1);
    }
  }
}

module.exports = App;