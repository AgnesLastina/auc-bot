const { connectDB } = require('./db/mongo');
const bot = require('./bot/bot');
const logger = require('./utils/logger');
const scheduler = require('./services/scheduler.service');
const auctionService = require('./services/auction.service');

auctionService.setBot(bot);
scheduler.setBot(bot);

console.log('=== Starting Horse Auction Bot ===');
console.log('Time:', new Date().toLocaleString());

// ========== ЗАГРУЗКА ОБРАБОТЧИКОВ ==========
try { require('./bot/commands/start'); console.log('✅ start.js loaded'); } catch (e) { console.error('❌ start.js:', e.message); }
try { require('./bot/handlers/callback')(bot); console.log('✅ callback.js loaded'); } catch (e) { console.error('❌ callback.js:', e.message); }
try { require('./bot/handlers/drafts')(bot); console.log('✅ drafts.js loaded'); } catch (e) { console.error('❌ drafts.js:', e.message); }
try { require('./bot/handlers/templates')(bot); console.log('✅ templates.js loaded'); } catch (e) { console.error('❌ templates.js:', e.message); }
try { require('./bot/handlers/message')(bot); console.log('✅ message.js loaded'); } catch (e) { console.error('❌ message.js:', e.message); }
try { require('./bot/handlers/admin'); console.log('✅ admin.js loaded'); } catch (e) { console.error('❌ admin.js:', e.message); }
try { require('./bot/handlers/bids'); console.log('✅ bids.js loaded'); } catch (e) { console.error('❌ bids.js:', e.message); }
try { require('./bot/handlers/horseParams'); console.log('✅ horseParams.js loaded'); } catch (e) { console.error('❌ horseParams.js:', e.message); }

let launchAttempts = 0;

const start = async () => {
  try {
    await connectDB();
    console.log('⏳ Launching bot...');
    launchAttempts++;
    bot.launch({ dropPendingUpdates: false, allowedUpdates: [] })
      .then(() => { console.log('ℹ️ bot.launch() завершился'); launchAttempts = 0; })
      .catch((err) => {
        console.error('=== ❌ LAUNCH ERROR ==='); console.error('Message:', err.message);
        if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.message?.includes('Client network socket disconnected') || err.message?.includes('socket hang up')) {
          const delay = Math.min(30000, 5000 * launchAttempts);
          setTimeout(start, delay);
          return;
        }
      });
    setTimeout(() => { console.log('🚀 Bot is running!'); logger.info('Bot started successfully'); scheduler.start(); }, 2000);
  } catch (error) {
    console.error('=== ❌ START ERROR ==='); console.error('Message:', error.message);
    const delay = Math.min(30000, 5000 * (launchAttempts || 1));
    setTimeout(start, delay);
  }
};

process.once('SIGINT', () => { bot.stop('SIGINT'); scheduler.stop(); process.exit(0); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); scheduler.stop(); process.exit(0); });
process.on('uncaughtException', (error) => { logger.error('CRITICAL:', error.message); });
process.on('unhandledRejection', (reason) => { logger.error('UNHANDLED:', reason?.message || reason); });

start();
