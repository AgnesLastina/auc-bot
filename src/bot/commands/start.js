const bot = require('../bot');
const auctionService = require('../../services/auction.service');
const settingsService = require('../../services/settings.service');
const keyboards = require('../keyboards/main');
const User = require('../../db/models/User');
const Auction = require('../../db/models/Auction');
const AuctionDraft = require('../../db/models/AuctionDraft');
const ModerationLog = require('../../db/models/ModerationLog');
const moment = require('moment');
const config = require('../../config');
const schedulerService = require('../../services/scheduler.service');
const { Markup } = require('telegraf');

// ========== AUTO-DELETE + KEYBOARD ==========
const lastBotMsgId = new Map();

async function replyWithKeyboard(ctx, text, extra = {}) {
  const uid = ctx.from?.id;
  const isAdmin = config.ADMIN_IDS.includes(uid);

  if (!extra.reply_markup) {
    extra.reply_markup = keyboards.mainMenuKeyboard(isAdmin).reply_markup;
  }

  const prevId = lastBotMsgId.get(uid);
  if (prevId) {
    try { await ctx.telegram.deleteMessage(ctx.chat.id, prevId); } catch (e) {}
  }

  const msg = await ctx.telegram.sendMessage(ctx.chat.id, text, extra);
  lastBotMsgId.set(uid, msg.message_id);
  return msg;
}

// Middleware: удаление сообщений пользователя (только команды меню)
bot.use(async (ctx, next) => {
  const uid = ctx.from?.id;
  const txt = ctx.message?.text;

  if (txt && uid) {
    const cmds = [
      '🛒 Создать аукцион', '📋 Мои аукционы', '🎯 Активные участия',
      '👤 Профиль', '🔔 Настройки уведомлений', '🆘 Поддержка / Спор',
      '👑 Админ-панель', '👤 Обычное меню', '📝 Ожидают проверки',
      '🟢 Активные аукционы', '🚫 Заблокированные', '📋 Логи модерации',
      '⚙️ Настройки бота', '🏆 Рейтинг', '💰 Баланс', '/start', '/status'
    ];

    if (cmds.includes(txt)) {
      setTimeout(async () => {
        try { await ctx.deleteMessage(); } catch (e) {}
      }, 500);
    }
  }
  return next();
});

// ============ КОМАНДА /start ============
bot.start(async (ctx) => {
  const payload = ctx.startPayload;
  const userId = ctx.from.id;
  const isAdmin = config.ADMIN_IDS.includes(userId);

  console.log('Start command from:', userId, 'isAdmin:', isAdmin);

  if (payload) {
    if (payload.startsWith('bid_')) {
      const auctionId = payload.replace('bid_', '');
      await require('../handlers/bids').handleBid(ctx, auctionId);
      return;
    } else if (payload.startsWith('watch_')) {
      const auctionId = payload.replace('watch_', '');
      await require('../handlers/bids').handleWatch(ctx, auctionId);
      return;
    } else if (payload.startsWith('cancelbid_')) {
      const auctionId = payload.replace('cancelbid_', '');
      await require('../handlers/bids').handleCancelBid(ctx, auctionId);
      return;
    } else if (payload.startsWith('buyout_')) {
      const auctionId = payload.replace('buyout_', '');
      await require('../handlers/bids').handleBuyout(ctx, auctionId);
      return;
    } else if (payload.startsWith('params_')) {
      const auctionId = payload.replace('params_', '');
      await handleShowParams(ctx, auctionId);
      return;
    }
  }

  if (isAdmin) {
    console.log('Showing admin panel');
    const pendingDrafts = await AuctionDraft.countDocuments({ status: 'pending_review' });
    const activeAuctions = await Auction.countDocuments({ status: 'active' });
    const bannedUsers = await User.countDocuments({ isAuctionBanned: true });

    const adminMessage =
      `👑 Админ-панель\n\n` +
      `Добро пожаловать, @${ctx.from.username || 'админ'}!\n\n` +
      `📊 Статистика:\n` +
      `📝 Ожидают проверки: ${pendingDrafts}\n` +
      `🟢 Активных аукционов: ${activeAuctions}\n` +
      `🚫 Заблокированных: ${bannedUsers}\n\n` +
      `Используйте кнопки ниже:`;

    await replyWithKeyboard(ctx, adminMessage, keyboards.adminPanelKeyboard());
    return;
  }

  await auctionService.findOrCreateUser(userId, ctx.from);

  const welcomeMessage =
    `༅༄࿓ Добро пожаловать в LUNALO!\n\n` +
    `Закрепите сообщение и используйте команду /start, если кнопки в клавиатуре исчезнут!\n\n` +
    `Пожалуйста, сообщайте Агнес, если:\n\n` +
    `• Пропала клавиатура\n` +
    `• Возникла какая-либо ошибка\n` +
    `• Ощущаете неудобства на каком-либо этапе\n\n` +
    `Используйте появившиеся ниже кнопки для навигации.`;

  await replyWithKeyboard(ctx, welcomeMessage);
});

// ============ КНОПКА "СОЗДАТЬ АУКЦИОН" ============
bot.hears('🛒 Создать аукцион', async (ctx) => {
  console.log('🔥 HEAR: Создать аукцион');
  try {
    const { showDraftsList } = require('../handlers/drafts');
    await showDraftsList(ctx, ctx.from.id);
  } catch (e) {
    console.error('🔥 ОШИБКА в showDraftsList:', e.message);
    console.error(e.stack);
    await ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
  }
});

// ============ НАСТРОЙКИ БОТА ============
bot.hears('⚙️ Настройки бота', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) return;

  const settings = await settingsService.get();

  const modeText = settings.publishMode === 'auto'
    ? '🚀 *АВТО-публикация*\nАукционы публикуются в канал сразу после проверки.'
    : '👮 *РУЧНАЯ публикация*\nАукционы публикуются только после нажатия «Одобрить».';

  const verifyText = settings.autoVerify
    ? '✅ *Проверка фото ВКЛ*\nСкриншоты сверяются с шаблоном.'
    : '❌ *Проверка фото ВЫКЛ*\nСкриншоты не проверяются, всё решает модератор.';

  const message =
    `⚙️ *Настройки бота*\n\n` +
    `${modeText}\n\n` +
    `${verifyText}\n\n` +
    `Нажмите на кнопку, чтобы переключить режим:`;

  const prevId = lastBotMsgId.get(ctx.from.id);
  if (prevId) {
    try { await ctx.telegram.deleteMessage(ctx.chat.id, prevId); } catch (e) {}
  }

  const msg = await ctx.telegram.sendMessage(ctx.chat.id, message, {
    parse_mode: 'Markdown',
    ...keyboards.botSettingsKeyboard(settings)
  });
  lastBotMsgId.set(ctx.from.id, msg.message_id);
});

bot.action('settings_toggle_publish', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    await ctx.answerCbQuery('⛔ Доступ запрещён');
    return;
  }

  const settings = await settingsService.get();
  const newMode = settings.publishMode === 'auto' ? 'manual' : 'auto';
  await settingsService.setPublishMode(newMode, ctx.from.id);

  await ctx.answerCbQuery(
    newMode === 'auto' ? '🚀 Включена АВТО-публикация' : '👮 Включена РУЧНАЯ публикация'
  );

  const updated = await settingsService.get();
  const modeText = updated.publishMode === 'auto'
    ? '🚀 *АВТО-публикация*\nАукционы публикуются в канал сразу после проверки.'
    : '👮 *РУЧНАЯ публикация*\nАукционы публикуются только после нажатия «Одобрить».';

  const verifyText = updated.autoVerify
    ? '✅ *Проверка фото ВКЛ*\nСкриншоты сверяются с шаблоном.'
    : '❌ *Проверка фото ВЫКЛ*\nСкриншоты не проверяются, всё решает модератор.';

  const message =
    `⚙️ *Настройки бота*\n\n` +
    `${modeText}\n\n` +
    `${verifyText}\n\n` +
    `Нажмите на кнопку, чтобы переключить режим:`;

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...keyboards.botSettingsKeyboard(updated)
    });
  } catch (e) {}
});

bot.action('settings_toggle_verify', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    await ctx.answerCbQuery('⛔ Доступ запрещён');
    return;
  }

  const settings = await settingsService.get();
  await settingsService.setAutoVerify(!settings.autoVerify, ctx.from.id);

  await ctx.answerCbQuery(
    !settings.autoVerify ? '✅ Проверка фото ВКЛ' : '❌ Проверка фото ВЫКЛ'
  );

  const updated = await settingsService.get();
  const modeText = updated.publishMode === 'auto'
    ? '🚀 *АВТО-публикация*\nАукционы публикуются в канал сразу после проверки.'
    : '👮 *РУЧНАЯ публикация*\nАукционы публикуются только после нажатия «Одобрить».';

  const verifyText = updated.autoVerify
    ? '✅ *Проверка фото ВКЛ*\nСкриншоты сверяются с шаблоном.'
    : '❌ *Проверка фото ВЫКЛ*\nСкриншоты не проверяются, всё решает модератор.';

  const message =
    `⚙️ *Настройки бота*\n\n` +
    `${modeText}\n\n` +
    `${verifyText}\n\n` +
    `Нажмите на кнопку, чтобы переключить режим:`;

  try {
    await ctx.editMessageText(message, {
      parse_mode: 'Markdown',
      ...keyboards.botSettingsKeyboard(updated)
    });
  } catch (e) {}
});

bot.action('settings_back', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage();

  const pendingDrafts = await AuctionDraft.countDocuments({ status: 'pending_review' });
  const activeAuctions = await Auction.countDocuments({ status: 'active' });
  const bannedUsers = await User.countDocuments({ isAuctionBanned: true });

  const adminMessage =
    `👑 Админ-панель\n\n` +
    `Добро пожаловать, @${ctx.from.username || 'админ'}!\n\n` +
    `📊 Статистика:\n` +
    `📝 Ожидают проверки: ${pendingDrafts}\n` +
    `🟢 Активных аукционов: ${activeAuctions}\n` +
    `🚫 Заблокированных: ${bannedUsers}\n\n` +
    `Используйте кнопки ниже:`;

  await replyWithKeyboard(ctx, adminMessage, keyboards.adminPanelKeyboard());
});

// ============ МОИ АУКЦИОНЫ ============
bot.hears('📋 Мои аукционы', async (ctx) => {
  try {
    const auctions = await Auction.find({
      userId: ctx.from.id,
      status: 'active'
    }).sort({ createdAt: -1 });

    // ✅ Даже если нет активных — показываем кнопку «Шаблоны»
    if (auctions.length === 0) {
      const msg = await ctx.telegram.sendMessage(
        ctx.chat.id,
        'У вас нет активных аукционов.\n\nНо вы можете посмотреть свои шаблоны:',
        Markup.inlineKeyboard([
          [Markup.button.callback('📁 Шаблоны', 'show_templates')],
          [Markup.button.callback('❌ Закрыть', 'close_my_auctions')]
        ])
      );
      lastBotMsgId.set(ctx.from.id, msg.message_id);
      return;
    }

    const horseAuctions = auctions.filter(a => a.category === 'horse');
    const accessoryAuctions = auctions.filter(a => a.category === 'accessory');
    const potionAuctions = auctions.filter(a => a.category === 'potion');

    let message = '📋 *Ваши активные аукционы:*\n\n';
    let auctionIndex = 1;
    const auctionMap = {};

    if (horseAuctions.length > 0) {
      message += '🎠 *Аукционы на лошадь:*\n\n';
      for (const auction of horseAuctions) {
        const displayBid = auction.currentBidDisplay || auction.currentBid || auction.data.startPrice || '0';
        auctionMap[auctionIndex] = auction._id.toString();
        message += `${auctionIndex}. 🟢 ${auction.data.species || 'Неизвестно'}\n`;
        message += `   Текущая ставка: ${displayBid} ${auction.data.currency || ''}\n`;
        message += `   ID аукциона: #${auction._id.toString().slice(-6)}\n\n`;
        auctionIndex++;
      }
    }

    if (accessoryAuctions.length > 0) {
      message += '👘 *Аукционы на аксессуар:*\n\n';
      for (const auction of accessoryAuctions) {
        const displayBid = auction.currentBidDisplay || auction.currentBid || auction.data.startPrice || '0';
        auctionMap[auctionIndex] = auction._id.toString();
        message += `${auctionIndex}. 🟢 ${auction.data.name || 'Неизвестно'}\n`;
        message += `   Текущая ставка: ${displayBid} ${auction.data.currency || ''}\n`;
        message += `   ID аукциона: #${auction._id.toString().slice(-6)}\n\n`;
        auctionIndex++;
      }
    }

    if (potionAuctions.length > 0) {
      message += '🍷 *Аукционы на зелье:*\n\n';
      for (const auction of potionAuctions) {
        const displayBid = auction.currentBidDisplay || auction.currentBid || auction.data.startPrice || '0';
        auctionMap[auctionIndex] = auction._id.toString();
        message += `${auctionIndex}. 🟢 ${auction.data.name || 'Неизвестно'}\n`;
        message += `   Текущая ставка: ${displayBid} ${auction.data.currency || ''}\n`;
        message += `   ID аукциона: #${auction._id.toString().slice(-6)}\n\n`;
        auctionIndex++;
      }
    }

    ctx.session.myAuctionsMap = auctionMap;

    // ✅ Добавлена кнопка «📁 Шаблоны»
    const buttons = [
      [Markup.button.callback('📌 Выбрать аукцион', 'select_my_auction')],
      [Markup.button.callback('📁 Шаблоны', 'show_templates')],
      [Markup.button.callback('❌ Закрыть', 'close_my_auctions')]
    ];

    await replyWithKeyboard(ctx, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard(buttons)
    });

  } catch (error) {
    console.error('My auctions error:', error);
    await replyWithKeyboard(ctx, 'Произошла ошибка. Попробуйте позже.');
  }
});

bot.action('close_my_auctions', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage();
  const isAdmin = config.ADMIN_IDS.includes(ctx.from.id);
  await replyWithKeyboard(ctx, '📋 Главное меню', keyboards.mainMenuKeyboard(isAdmin));
});

bot.action('select_my_auction', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (e) {}

  const auctionMap = ctx.session?.myAuctionsMap || {};
  const count = Object.keys(auctionMap).length;

  if (count === 0) {
    await replyWithKeyboard(ctx, 'У вас нет активных аукционов.');
    return;
  }

  const buttons = [];
  for (let i = 1; i <= count; i++) {
    buttons.push([Markup.button.callback(`${i}`, `my_auction_${i}`)]);
  }
  buttons.push([Markup.button.callback('❌ Закрыть', 'close_my_auctions')]);

  const msg = await ctx.telegram.sendMessage(ctx.chat.id, 'Выберите номер аукциона:', Markup.inlineKeyboard(buttons));
  lastBotMsgId.set(ctx.from.id, msg.message_id);
});

bot.action(/^my_auction_(\d+)$/, async (ctx) => {
  const index = parseInt(ctx.match[1]);
  const auctionMap = ctx.session?.myAuctionsMap || {};
  const auctionId = auctionMap[index];

  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (e) {}

  if (!auctionId) {
    await replyWithKeyboard(ctx, '❌ Аукцион не найден');
    return;
  }

  const auction = await Auction.findById(auctionId);
  if (!auction) {
    await replyWithKeyboard(ctx, '❌ Аукцион не найден');
    return;
  }

  const displayBid = auction.currentBidDisplay || auction.currentBid || auction.data.startPrice || '0';
  const auctionLink = auction.channelPostUrl || `https://t.me/c/${config.CHANNEL_ID.toString().replace('-100', '')}/${auction.channelMessageId}`;
  const hasEarlyEnd = auction.data.earlyEnd === 'да' && auction.status === 'active';
  const hasBids = auction.bids && auction.bids.length > 0;

  let message = `📋 *Аукцион #${auction._id.toString().slice(-6)}*\n\n` +
    `Лот: ${auction.data.name || auction.data.species || 'Неизвестно'}\n` +
    `Текущая ставка: ${displayBid} ${auction.data.currency || ''}\n` +
    `Статус: ${auction.status}\n\n` +
    `[🔗 Перейти к аукциону](${auctionLink})`;

  const buttons = [
    [Markup.button.callback('❌ Отменить аукцион', `cancel_my_auction_${auction._id}`)]
  ];

  if (hasEarlyEnd && hasBids) {
    buttons.push([Markup.button.callback('⏰ Завершить досрочно', `early_end_auction_${auction._id}`)]);
  }

  buttons.push([Markup.button.callback('◀️ Назад', 'select_my_auction')]);
  buttons.push([Markup.button.callback('❌ Закрыть', 'close_my_auctions')]);

  const msg = await ctx.telegram.sendMessage(ctx.chat.id, message, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    ...Markup.inlineKeyboard(buttons)
  });

  lastBotMsgId.set(ctx.from.id, msg.message_id);
  ctx.session.myAuctionIndex = index;
});

bot.action(/^cancel_my_auction_(.+)$/, async (ctx) => {
  const auctionId = ctx.match[1];
  const auction = await Auction.findById(auctionId);

  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (e) {}

  if (!auction) {
    await replyWithKeyboard(ctx, '❌ Аукцион не найден');
    return;
  }

  const hasBids = auction.bids && auction.bids.length > 0;

  if (hasBids) {
    const bidCount = auction.bids.length;
    const uniqueBidders = [...new Set(auction.bids.map(b => b.userId))];
    const bidderNames = await Promise.all(
      uniqueBidders.map(async (uid) => {
        const user = await User.findOne({ telegramId: uid });
        return `@${user?.username || uid}`;
      })
    );

    const banUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const banDate = moment(banUntil).format('DD.MM.YYYY в HH:mm');

    const msg = await ctx.telegram.sendMessage(ctx.chat.id,
      `⚠️ *ВНИМАНИЕ!*\n\n` +
      `Вы собираетесь отменить аукцион, на котором:\n` +
      `📊 Ставок: *${bidCount}*\n` +
      `👥 Участников: *${uniqueBidders.length}*\n` +
      `👤 Участники: ${bidderNames.join(', ')}\n\n` +
      `*ШТРАФ ЗА ОТМЕНУ:*\n` +
      `🚫 Запрет на создание аукционов\n` +
      `🚫 Запрет на участие в торгах\n` +
      `⏰ Срок: 7 дней (до ${banDate})\n\n` +
      `Вы уверены, что хотите отменить аукцион?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Да, отменить (штраф)', `confirm_cancel_auction_${auctionId}`)],
          [Markup.button.callback('❌ Нет, оставить', `my_auction_${ctx.session.myAuctionIndex || 1}`)]
        ])
      }
    );
    lastBotMsgId.set(ctx.from.id, msg.message_id);
  } else {
    const msg = await ctx.telegram.sendMessage(ctx.chat.id,
      `📋 *Отмена аукциона*\n\n` +
      `На этом аукционе нет ставок.\n` +
      `Отмена пройдёт без штрафа.\n\n` +
      `Вы уверены, что хотите отменить аукцион?`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Да, отменить', `confirm_cancel_auction_${auctionId}`)],
          [Markup.button.callback('❌ Нет', `my_auction_${ctx.session.myAuctionIndex || 1}`)]
        ])
      }
    );
    lastBotMsgId.set(ctx.from.id, msg.message_id);
  }
});

bot.action(/^confirm_cancel_auction_(.+)$/, async (ctx) => {
  const auctionId = ctx.match[1];
  const auction = await Auction.findById(auctionId);

  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (e) {}

  if (!auction) {
    await replyWithKeyboard(ctx, '❌ Аукцион не найден');
    return;
  }

  const hasBids = auction.bids && auction.bids.length > 0;

  if (hasBids) {
    const banUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await User.updateOne(
      { telegramId: auction.userId },
      {
        isAuctionBanned: true,
        auctionBanReason: 'Отмена аукциона со ставками',
        auctionBanUntil: banUntil
      }
    );
  }

  auction.status = 'cancelled';
  await auction.save();

  await updateChannelPost(auction);

  await replyWithKeyboard(ctx, '✅ Аукцион отменён.');
});

bot.action(/^early_end_auction_(.+)$/, async (ctx) => {
  const auctionId = ctx.match[1];
  const auction = await Auction.findById(auctionId);

  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (e) {}

  if (!auction) {
    await replyWithKeyboard(ctx, '❌ Аукцион не найден');
    return;
  }

  if (!auction.currentLeader) {
    await replyWithKeyboard(ctx, '❌ Нет ставок для досрочного завершения');
    return;
  }

  auction.status = 'ended';
  auction.endedBy = 'seller';
  await auction.save();

  await updateChannelPost(auction);

  const notificationService = require('../../services/notification.service');
  await notificationService.notifyAuctionEnded(auction);

  await replyWithKeyboard(ctx, '✅ Аукцион завершён досрочно.');
});

// ============ АКТИВНЫЕ УЧАСТИЯ ============
bot.hears('🎯 Активные участия', async (ctx) => {
  try {
    const participations = await Auction.find({
      'bids.userId': ctx.from.id,
      status: 'active'
    }).sort({ endDate: 1 });

    if (participations.length === 0) {
      await replyWithKeyboard(ctx, 'Вы пока не участвуете ни в одном аукционе.');
      return;
    }

    let message = '🎯 *Ваши активные участия:*\n\n';
    const participationMap = {};
    let index = 1;

    for (const auction of participations) {
      const userBid = auction.bids.filter(b => b.userId === ctx.from.id).sort((a, b) => b.amount - a.amount)[0];
      const isLeader = auction.currentLeader?.userId === ctx.from.id;
      const displayBid = auction.currentBidDisplay || auction.currentBid || auction.data.startPrice || '0';
      const auctionLink = auction.channelPostUrl || `https://t.me/c/${config.CHANNEL_ID.toString().replace('-100', '')}/${auction.channelMessageId}`;

      participationMap[index] = auction._id.toString();

      message += `${index}. ${isLeader ? '👑' : '💰'} ${auction.data.name || auction.data.species || 'Аукцион'}\n`;
      message += `   Ваша ставка: ${userBid?.originalText || userBid?.amount || 0}\n`;
      message += `   Текущая ставка: ${displayBid} ${auction.data.currency || ''}\n`;
      message += `   ID аукциона: #${auction._id.toString().slice(-6)}\n`;
      message += `   [🔗 Ссылка](${auctionLink})\n\n`;
      index++;
    }

    ctx.session.participationMap = participationMap;

    const buttons = [[Markup.button.callback('📌 Выбрать аукцион', 'select_participation')]];

    await replyWithKeyboard(ctx, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard(buttons)
    });

  } catch (error) {
    console.error('Participations error:', error);
    await replyWithKeyboard(ctx, 'Произошла ошибка. Попробуйте позже.');
  }
});

bot.action('select_participation', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (e) {}

  const participationMap = ctx.session?.participationMap || {};
  const count = Object.keys(participationMap).length;

  if (count === 0) {
    await replyWithKeyboard(ctx, 'У вас нет активных участий.');
    return;
  }

  const buttons = [];
  for (let i = 1; i <= count; i++) {
    buttons.push([Markup.button.callback(`${i}`, `participation_${i}`)]);
  }
  buttons.push([Markup.button.callback('◀️ Назад', 'back_to_main')]);

  const msg = await ctx.telegram.sendMessage(ctx.chat.id, 'Выберите номер аукциона:', Markup.inlineKeyboard(buttons));
  lastBotMsgId.set(ctx.from.id, msg.message_id);
});

bot.action(/^participation_(\d+)$/, async (ctx) => {
  const index = parseInt(ctx.match[1]);
  const participationMap = ctx.session?.participationMap || {};
  const auctionId = participationMap[index];

  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (e) {}

  if (!auctionId) {
    await replyWithKeyboard(ctx, '❌ Аукцион не найден');
    return;
  }

  const auction = await Auction.findById(auctionId);
  if (!auction) {
    await replyWithKeyboard(ctx, '❌ Аукцион не найден');
    return;
  }

  const userBid = auction.bids.filter(b => b.userId === ctx.from.id).sort((a, b) => b.amount - a.amount)[0];
  const displayBid = auction.currentBidDisplay || auction.currentBid || auction.data.startPrice || '0';
  const buyoutPrice = auction.data.autoBuyoutPrice;
  const hasBuyout = auction.data.autoBuyout === 'да' && buyoutPrice;
  const auctionLink = auction.channelPostUrl || `https://t.me/c/${config.CHANNEL_ID.toString().replace('-100', '')}/${auction.channelMessageId}`;

  let message = `💰 *СТАВКА*\n\n` +
    `Лот: ${auction.data.name || auction.data.species || 'Аукцион'}\n` +
    `Текущая ставка: ${displayBid} ${auction.data.currency || ''}\n`;

  if (hasBuyout) {
    message += `⚡ Автовыкуп: ${buyoutPrice} ${auction.data.currency || ''}\n`;
  }

  message += `Минимальный шаг: ${auction.data.minStep || 'не указан'}\n\n` +
    `[🔗 Перейти к аукциону](${auctionLink})`;

  ctx.session.selectedParticipationId = auctionId;

  const msg = await ctx.telegram.sendMessage(ctx.chat.id, message, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    ...Markup.inlineKeyboard([
      [Markup.button.callback('❌ Отменить ставку', `cancel_bid_from_participation_${auctionId}`)],
      [Markup.button.callback('🔔 Подписаться', `watch_from_participation_${auctionId}`)]
    ])
  });
  lastBotMsgId.set(ctx.from.id, msg.message_id);
});

bot.action(/^cancel_bid_from_participation_(.+)$/, async (ctx) => {
  const auctionId = ctx.match[1];
  const { handleCancelBid } = require('../handlers/bids');
  await ctx.answerCbQuery();
  await ctx.deleteMessage();
  await handleCancelBid(ctx, auctionId);
});

bot.action(/^watch_from_participation_(.+)$/, async (ctx) => {
  const auctionId = ctx.match[1];
  const { handleWatch } = require('../handlers/bids');
  await ctx.answerCbQuery();
  await ctx.deleteMessage();
  await handleWatch(ctx, auctionId);
});

// ============ ПРОФИЛЬ ============
bot.hears('👤 Профиль', async (ctx) => {
  try {
    const user = await auctionService.findOrCreateUser(ctx.from.id, ctx.from);

    const username = user.username || 'не указан';
    const firstName = user.firstName || 'не указано';
    const lastName = user.lastName || '';

    let banInfo = '';
    if (user.isAuctionBanned && user.auctionBanUntil) {
      banInfo = `\n⏰ Разбан: ${moment(user.auctionBanUntil).format('DD.MM.YYYY HH:mm')}`;
    }

    const message =
      `<b>👤 Профиль пользователя</b>\n\n` +
      `🆔 ID: <code>${user.telegramId}</code>\n` +
      `📛 Username: @${username}\n` +
      `👋 Имя: ${firstName} ${lastName}\n` +
      `📅 Дата регистрации: ${moment(user.createdAt).format('DD.MM.YYYY')}\n` +
      `🚫 Статус: ${user.isAuctionBanned ? '❌ Заблокирован' : '✅ Активен'}${banInfo}`;

    await replyWithKeyboard(ctx, message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Profile error:', error);
    await replyWithKeyboard(ctx, 'Произошла ошибка. Попробуйте позже.');
  }
});

// ============ СТАТУС (АДМИН) ============
bot.command('status', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    await replyWithKeyboard(ctx, '⛔ Access denied');
    return;
  }

  const health = require('../../services/health.service');
  const status = health.getStatus();
  const stats = await health.getStats();

  const message =
    `📊 *Bot Status*\n\n` +
    `✅ Status: ${status.healthy ? 'Healthy' : '⚠️ Issues detected'}\n` +
    `⏱ Uptime: ${status.uptime}\n` +
    `🗄 Database: ${status.dbConnected ? '✅ Connected' : '❌ Disconnected'}\n` +
    `⚠️ Errors: ${status.errors}\n\n` +
    `📈 *Statistics*\n` +
    `🟢 Active auctions: ${stats.activeAuctions}\n` +
    `📝 Pending drafts: ${stats.pendingDrafts}\n` +
    `🚫 Banned users: ${stats.bannedUsers}\n` +
    `👥 Total users: ${stats.totalUsers}`;

  await replyWithKeyboard(ctx, message, { parse_mode: 'Markdown' });
});

// ============ НАСТРОЙКИ УВЕДОМЛЕНИЙ ============
bot.hears('🔔 Настройки уведомлений', async (ctx) => {
  try {
    const user = await User.findOne({ telegramId: ctx.from.id });
    const status = user?.notificationsEnabled ? 'включены' : 'выключены';

    const prevId = lastBotMsgId.get(ctx.from.id);
    if (prevId) {
      try { await ctx.telegram.deleteMessage(ctx.chat.id, prevId); } catch (e) {}
    }

    const msg = await ctx.telegram.sendMessage(ctx.chat.id,
      `🔔 *Настройки уведомлений*\n\n` +
      `Текущий статус: ${status}\n\n` +
      `Выберите действие:`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Включить уведомления', 'notify_on')],
          [Markup.button.callback('❌ Выключить уведомления', 'notify_off')],
          [Markup.button.callback('❌ Закрыть', 'close_notify')]
        ])
      }
    );
    lastBotMsgId.set(ctx.from.id, msg.message_id);
  } catch (error) {
    console.error('Notifications error:', error);
    await replyWithKeyboard(ctx, 'Произошла ошибка. Попробуйте позже.');
  }
});

bot.action('close_notify', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage();
  const isAdmin = config.ADMIN_IDS.includes(ctx.from.id);
  await replyWithKeyboard(ctx, '📋 Главное меню', keyboards.mainMenuKeyboard(isAdmin));
});

bot.action('notify_on', async (ctx) => {
  await User.updateOne({ telegramId: ctx.from.id }, { notificationsEnabled: true });
  await ctx.answerCbQuery('Уведомления включены');
  await ctx.deleteMessage();
  await replyWithKeyboard(ctx, '🔔 Уведомления *включены*', { parse_mode: 'Markdown' });
});

bot.action('notify_off', async (ctx) => {
  await User.updateOne({ telegramId: ctx.from.id }, { notificationsEnabled: false });
  await ctx.answerCbQuery('Уведомления выключены');
  await ctx.deleteMessage();
  await replyWithKeyboard(ctx, '🔕 Уведомления *выключены*', { parse_mode: 'Markdown' });
});

bot.action('back_to_main', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage();
  const isAdmin = config.ADMIN_IDS.includes(ctx.from.id);
  await replyWithKeyboard(ctx, '📋 Главное меню', keyboards.mainMenuKeyboard(isAdmin));
});

// ============ ПОДДЕРЖКА ============
bot.hears('🆘 Поддержка / Спор', async (ctx) => {
  const message =
    `🆘 Поддержка\n\n` +
    `Если у вас возникли вопросы или проблемы:\n\n` +
    `• Напишите администратору:\n` +
    `t.me/HL_auctions?direct\n\n` +
    `• Опишите ситуацию и приложите ID аукциона\n\n` +
    `Мы ответим в ближайшее время!`;

  await replyWithKeyboard(ctx, message);
});

// ============ АДМИН-ПАНЕЛЬ ============
bot.hears('📝 Ожидают проверки', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) return;

  const bannedUserIds = await User.find({ isAuctionBanned: true }).distinct('telegramId');
  if (bannedUserIds.length > 0) {
    await AuctionDraft.deleteMany({ userId: { $in: bannedUserIds }, status: 'pending_review' });
  }

  const pending = await AuctionDraft.find({ status: 'pending_review' }).sort({ createdAt: -1 }).limit(20);

  if (pending.length === 0) {
    await replyWithKeyboard(ctx, 'Нет аукционов, ожидающих проверки.', keyboards.adminPanelKeyboard());
    return;
  }

  let message = '📝 *Аукционы на проверке:*\n\n';
  for (const draft of pending) {
    const user = await User.findOne({ telegramId: draft.userId });
    message += `🆔 #${draft._id.toString().slice(-6)}\n`;
    message += `📦 ${draft.category === 'horse' ? 'Лошадь' : draft.category === 'accessory' ? 'Аксессуар' : 'Зелье'}\n`;
    message += `👤 @${user?.username || 'нет'} | ${draft.userId}\n\n`;
  }

  await replyWithKeyboard(ctx, message, { parse_mode: 'Markdown', ...keyboards.adminPanelKeyboard() });
});

bot.hears('👑 Админ-панель', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    await replyWithKeyboard(ctx, '⛔ Доступ запрещён');
    return;
  }

  const pendingDrafts = await AuctionDraft.countDocuments({ status: 'pending_review' });
  const activeAuctions = await Auction.countDocuments({ status: 'active' });
  const bannedUsers = await User.countDocuments({ isAuctionBanned: true });

  const adminMessage =
    `👑 Админ-панель\n\n` +
    `Добро пожаловать, @${ctx.from.username || 'админ'}!\n\n` +
    `📊 Статистика:\n` +
    `📝 Ожидают проверки: ${pendingDrafts}\n` +
    `🟢 Активных аукционов: ${activeAuctions}\n` +
    `🚫 Заблокированных: ${bannedUsers}\n\n` +
    `Используйте кнопки ниже:`;

  await replyWithKeyboard(ctx, adminMessage, keyboards.adminPanelKeyboard());
});

bot.hears('🟢 Активные аукционы', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) return;

  const active = await Auction.find({ status: 'active' }).sort({ createdAt: -1 }).limit(20);

  if (active.length === 0) {
    await replyWithKeyboard(ctx, 'Нет активных аукционов.', keyboards.adminPanelKeyboard());
    return;
  }

  let message = '🟢 *Активные аукционы:*\n\n';
  for (const auction of active) {
    message += `🆔 #${auction._id.toString().slice(-6)}\n`;
    message += `📦 ${auction.data.name || auction.data.species || 'Аукцион'}\n`;
    message += `💰 Ставка: ${auction.currentBidDisplay || auction.currentBid || 0}\n`;
    message += `📅 Конец: ${moment(auction.endDate).format('DD.MM.YYYY HH:mm')}\n\n`;
  }

  await replyWithKeyboard(ctx, message, { parse_mode: 'Markdown', ...keyboards.adminPanelKeyboard() });
});

bot.hears('🚫 Заблокированные', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) return;

  const banned = await User.find({ isAuctionBanned: true });

  if (banned.length === 0) {
    await replyWithKeyboard(ctx, 'Нет заблокированных пользователей.', keyboards.adminPanelKeyboard());
    return;
  }

  for (const user of banned) {
    let message = '🚫 *Заблокированные пользователи:*\n\n';
    message += `👤 @${user.username || 'нет'} | ${user.telegramId}\n`;
    message += `📝 Причина: ${user.auctionBanReason || 'Не указана'}\n`;
    message += `⏰ До: ${user.auctionBanUntil ? moment(user.auctionBanUntil).format('DD.MM.YYYY HH:mm') : 'Навсегда'}\n`;

    const buttons = [[Markup.button.callback(`♻️ Разблокировать @${user.username || user.telegramId}`, `unban_${user.telegramId}`)]];

    const prevId = lastBotMsgId.get(ctx.from.id);
    if (prevId) {
      try { await ctx.telegram.deleteMessage(ctx.chat.id, prevId); } catch (e) {}
    }

    const msg = await ctx.telegram.sendMessage(ctx.chat.id, message, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard(buttons)
    });
    lastBotMsgId.set(ctx.from.id, msg.message_id);
  }
});

bot.action(/^unban_(\d+)$/, async (ctx) => {
  const userId = parseInt(ctx.match[1]);

  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    await ctx.answerCbQuery('⛔ Доступ запрещён');
    return;
  }

  const user = await User.findOne({ telegramId: userId });
  if (!user || !user.isAuctionBanned) {
    await ctx.answerCbQuery('Пользователь не заблокирован');
    return;
  }

  await User.updateOne(
    { telegramId: userId },
    { isAuctionBanned: false, auctionBanReason: null, auctionBanUntil: null }
  );

  await ModerationLog.create({
    targetUserId: userId,
    adminId: ctx.from.id,
    action: 'unban'
  });

  try {
    await ctx.telegram.sendMessage(
      userId,
      '✅ Ограничения сняты администрацией. Теперь вы снова можете создавать аукционы и участвовать в ставках.'
    );
  } catch (e) {}

  const originalText = ctx.callbackQuery.message.text;
  const newText = originalText
    .replace(/🚫 \*Заблокированные пользователи\*/, '✅ *Пользователь разблокирован*')
    .replace(/♻️ Разблокировать.*/, '✅ *Разблокирован*');

  await ctx.editMessageText(newText, { parse_mode: 'Markdown' });
  await ctx.answerCbQuery('✅ Пользователь разблокирован');
});

bot.hears('📋 Логи модерации', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) return;

  const logs = await ModerationLog.find().sort({ createdAt: -1 }).limit(20);

  if (logs.length === 0) {
    await replyWithKeyboard(ctx, 'Нет логов модерации.', keyboards.adminPanelKeyboard());
    return;
  }

  let message = '📋 *Последние действия:*\n\n';
  for (const log of logs) {
    const admin = await User.findOne({ telegramId: log.adminId });
    message += `👮 Админ: @${admin?.username || log.adminId}\n`;
    message += `🔧 Действие: ${log.action}\n`;
    if (log.reason) message += `📝 Причина: ${log.reason}\n`;
    message += `📅 ${moment(log.createdAt).format('DD.MM.YYYY HH:mm')}\n\n`;
  }

  await replyWithKeyboard(ctx, message, { parse_mode: 'Markdown', ...keyboards.adminPanelKeyboard() });
});

bot.hears('👤 Обычное меню', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) return;
  await replyWithKeyboard(ctx, 'Переключено на обычное меню:', keyboards.mainMenuKeyboard(true));
});

bot.hears('🏆 Рейтинг', async (ctx) => {
  const pointsService = require('../../services/points.service');
  const top = await pointsService.getTopSellers(10);

  let message = '🏆 *Топ продавцов:*\n\n';
  top.forEach((u, i) => {
    message += `${i + 1}. @${u.username || u.telegramId} — ${u.points} баллов (${u.totalSales} продаж)\n`;
  });

  await replyWithKeyboard(ctx, message, { parse_mode: 'Markdown' });
});

bot.hears('💰 Баланс', async (ctx) => {
  const pointsService = require('../../services/points.service');
  const balance = await pointsService.getBalance(ctx.from.id);
  await replyWithKeyboard(ctx, `💰 Ваш баланс: *${balance}* баллов`, { parse_mode: 'Markdown' });
});

// ============ ЖАЛОБА ============
bot.action(/^report_auction_(.+)$/, async (ctx) => {
  const auctionId = ctx.match[1];
  await ctx.answerCbQuery();
  ctx.session.reportAuctionId = auctionId;

  const prevId = lastBotMsgId.get(ctx.from.id);
  if (prevId) {
    try { await ctx.telegram.deleteMessage(ctx.chat.id, prevId); } catch (e) {}
  }

  const msg = await ctx.telegram.sendMessage(ctx.chat.id,
    '📋 *Жалоба на аукцион*\n\nОпишите причину жалобы в одном сообщении:\n\n• Неверное описание\n• Мошенничество\n• Нарушение правил\n• Другое',
    { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
  );
  lastBotMsgId.set(ctx.from.id, msg.message_id);
});

bot.on('text', async (ctx, next) => {
  const reportAuctionId = ctx.session?.reportAuctionId;
  if (!reportAuctionId) return next();

  const reason = ctx.message.text;
  delete ctx.session.reportAuctionId;

  const auction = await Auction.findById(reportAuctionId);

  await ctx.telegram.sendMessage(
    config.ADMIN_CHAT_ID,
    `🚨 *НОВАЯ ЖАЛОБА*\n\n👤 От: @${ctx.from.username || 'нет'} | ${ctx.from.id}\n🆔 Аукцион: #${reportAuctionId.slice(-6)}\n📝 Причина: ${reason}\n\n[🔗 Ссылка](${auction?.channelPostUrl || ''})`,
    { parse_mode: 'Markdown', disable_web_page_preview: true }
  );

  await replyWithKeyboard(ctx, '✅ Жалоба отправлена администрации. Спасибо!');
});

// ============ ПОКАЗ ПАРАМЕТРОВ ============
async function handleShowParams(ctx, auctionId) {
  try {
    let auction = await Auction.findById(auctionId);
    if (!auction) {
      auction = await AuctionDraft.findById(auctionId);
    }

    if (!auction) {
      await replyWithKeyboard(ctx, '❌ Аукцион не найден');
      return;
    }

    const paramPhotos = auction.data?.paramPhotos || [];

    if (paramPhotos.length === 0) {
      await replyWithKeyboard(ctx, '❌ Продавец не добавил фото параметров');
      return;
    }

    await ctx.reply('📋 *Фото параметров лошади:*', { parse_mode: 'Markdown' });

    const mediaGroup = paramPhotos.map(fileId => ({
      type: 'photo',
      media: fileId
    }));

    await ctx.telegram.sendMediaGroup(ctx.chat.id, mediaGroup);

  } catch (error) {
    console.error('Error showing params:', error);
    await replyWithKeyboard(ctx, '❌ Ошибка при загрузке параметров');
  }
}

// ============ ОЧИСТКА БАЗЫ (АДМИН) ============
bot.command('reset_all', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    await ctx.reply('⛔ Доступ запрещён');
    return;
  }

  await ctx.reply(
    '⚠️ *ВНИМАНИЕ!*\n\nЭта команда удалит:\n• Все активные аукционы\n• Все черновики\n• Все ставки\n\nВы уверены?',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Да, удалить всё', 'confirm_reset_all')],
        [Markup.button.callback('❌ Отмена', 'cancel_reset')]
      ])
    }
  );
});

bot.action('cancel_reset', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage();
  await ctx.reply('❌ Операция отменена');
});

bot.action('confirm_reset_all', async (ctx) => {
  await ctx.answerCbQuery();

  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    await ctx.reply('⛔ Доступ запрещён');
    return;
  }

  try {
    const Auction = require('../../db/models/Auction');
    const AuctionDraft = require('../../db/models/AuctionDraft');

    const deletedAuctions = await Auction.deleteMany({});
    const deletedDrafts = await AuctionDraft.deleteMany({});

    await ctx.editMessageText(
      `✅ *База данных очищена!*\n\n` +
      `Удалено аукционов: ${deletedAuctions.deletedCount}\n` +
      `Удалено черновиков: ${deletedDrafts.deletedCount}`,
      { parse_mode: 'Markdown' }
    );

    console.log(`DB RESET: ${deletedAuctions.deletedCount} auctions, ${deletedDrafts.deletedCount} drafts deleted`);

  } catch (error) {
    console.error('Reset error:', error);
    await ctx.editMessageText('❌ Ошибка при очистке базы данных');
  }
});

bot.command('reset_drafts', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    await ctx.reply('⛔ Доступ запрещён');
    return;
  }

  const AuctionDraft = require('../../db/models/AuctionDraft');
  const result = await AuctionDraft.deleteMany({});

  await ctx.reply(`✅ Удалено черновиков: ${result.deletedCount}`);
});

bot.command('reset_auctions', async (ctx) => {
  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    await ctx.reply('⛔ Доступ запрещён');
    return;
  }

  const Auction = require('../../db/models/Auction');
  const result = await Auction.deleteMany({});

  await ctx.reply(`✅ Удалено аукционов: ${result.deletedCount}`);
});
