const { Telegraf, Markup } = require('telegraf');
const LocalSession = require('telegraf-session-local');
const { SocksProxyAgent } = require('socks-proxy-agent');
const config = require('../config');
const logger = require('../utils/logger');
const User = require('../db/models/User');

// ========== PROXY CONFIG ==========
const PROXY_URL = process.env.PROXY_URL || null;

const botOptions = {};

if (PROXY_URL) {
  try {
    botOptions.telegram = {
      agent: new SocksProxyAgent(PROXY_URL)
    };
    console.log(`🌐 Using SOCKS5 proxy: ${PROXY_URL.replace(/\/\/.*@/, '//***@')}`);
  } catch (e) {
    console.error('⚠️ Invalid PROXY_URL, running without proxy:', e.message);
  }
} else {
  console.log('🌐 Running without proxy');
}

const bot = new Telegraf(config.BOT_TOKEN, botOptions);

// ✅ Настройка polling с retry и увеличенным таймаутом
bot.telegram.options.agent = botOptions.telegram?.agent;

// Session middleware
const session = new LocalSession({
  database: 'session.json',
  storage: LocalSession.storageFileAsync
});

bot.use(session.middleware());

// ========== BAN CHECK + AUTO UNBAN ==========
bot.use(async (ctx, next) => {
  if (ctx.from) {
    try {
      const user = await User.findOne({ telegramId: ctx.from.id });

      if (user) {
        if (user.isAuctionBanned && user.auctionBanUntil && new Date() >= user.auctionBanUntil) {
          user.isAuctionBanned = false;
          user.auctionBanReason = null;
          user.auctionBanUntil = null;
          await user.save();
          try {
            await ctx.telegram.sendMessage(
              user.telegramId,
              '✅ Срок вашей блокировки истёк. Вы снова можете создавать аукционы и участвовать в ставках!'
            );
          } catch (e) {}
        }

        if (user.isAuctionBanned) {
          const allowed = ['/start', '👤 Профиль', '🆘 Поддержка / Спор', '🔔 Настройки уведомлений'];
          const text = ctx.message?.text;
          if (text && allowed.includes(text)) {
            return next();
          }
          if (ctx.updateType === 'message') {
            const banUntil = user.auctionBanUntil
              ? '\n⏰ Разбан: ' + require('moment')(user.auctionBanUntil).format('DD.MM.YYYY HH:mm')
              : '';
            await ctx.reply(
              '🚫 Вы заблокированы!\n\nПричина: ' +
                (user.auctionBanReason || 'Нарушение правил') +
                banUntil
            );
            return;
          }
        }
      }
    } catch (e) {}
  }
  return next();
});

// ========== DOUBLE CLICK PROTECTION ==========
const pendingActions = new Map();
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  const callbackData = ctx.callbackQuery?.data;
  if (callbackData && userId) {
    const key = userId + '_' + callbackData;
    if (pendingActions.has(key)) {
      await ctx.answerCbQuery('⏳ Запрос обрабатывается...').catch(() => {});
      return;
    }
    pendingActions.set(key, true);
    setTimeout(() => pendingActions.delete(key), 2000);
  }
  return next();
});

// ========== LOGGER ==========
bot.use(async (ctx, next) => {
  const start = Date.now();
  try {
    await next();
    const ms = Date.now() - start;
    logger.info(ctx.updateType + ' from ' + (ctx.from?.id || 'unknown') + ' - ' + ms + 'ms');
  } catch (error) {
    logger.error('Bot middleware error:', error.message);
    throw error;
  }
});

// ========== ERROR HANDLER ==========
bot.catch((err, ctx) => {
  console.error('=== ERROR ===');
  console.error('Type:', ctx.updateType);
  console.error('Message:', err.message);

  if (err.message?.includes('query is too old')) return;
  if (err.message?.includes('message to delete not found')) return;
  if (err.message?.includes('message is not modified')) return;
  if (err.message?.includes('bot was blocked')) return;
  if (err.message?.includes('Client network socket disconnected')) return;
  if (err.code === 'ECONNRESET') return;
  if (err.code === 'ETIMEDOUT') return;

  let msg = 'Произошла ошибка. Попробуйте позже.';
  if (err.code === 'ETIMEDOUT' || err.message?.includes('ETIMEDOUT')) {
    msg = '⏳ Сервер временно недоступен.';
  }
  if (err.message?.includes('SSL')) {
    msg = '🔒 Проблема с соединением.';
  }

  ctx.reply(msg).catch(() => {});
});

module.exports = bot;