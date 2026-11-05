const bot = require('../bot');
const Auction = require('../../db/models/Auction');
const User = require('../../db/models/User');
const auctionService = require('../../services/auction.service');
const notificationService = require('../../services/notification.service');
const schedulerService = require('../../services/scheduler.service');
const config = require('../../config');
const { parsePrice } = require('../../utils/validators');
const { Markup } = require('telegraf');

console.log('bids.js loaded!');

// ============ СДЕЛАТЬ СТАВКУ ============
const handleBid = async (ctx, auctionId) => {
  const userId = ctx.from.id;

  try {
    const auction = await Auction.findById(auctionId);
    if (!auction) {
      await ctx.reply('❌ Аукцион не найден');
      return;
    }

    if (auction.status !== 'active') {
      await ctx.reply('❌ Аукцион не активен');
      return;
    }

    if (auction.userId === userId) {
      await ctx.reply('❌ Вы не можете делать ставки на свой аукцион');
      return;
    }

    const user = await User.findOne({ telegramId: userId });
    if (user?.isAuctionBanned) {
      await ctx.reply('❌ Вы заблокированы в аукционах');
      return;
    }

    ctx.session.biddingAuctionId = auctionId;

    const currentBid = auction.currentBidDisplay || auction.currentBid || auction.data.startPrice || '0';
    const buyoutPrice = auction.data.autoBuyoutPrice;
    const hasBuyout = auction.data.autoBuyout === 'да' && buyoutPrice;

    const auctionLink = auction.channelPostUrl || `https://t.me/c/${config.CHANNEL_ID.toString().replace('-100', '')}/${auction.channelMessageId}`;

    let message = `💰 *СТАВКА*\n\n` +
      `Лот: ${auction.data.name || auction.data.species || 'Аукцион'}\n` +
      `Текущая ставка: ${currentBid} ${auction.data.currency || ''}\n`;

    if (hasBuyout) {
      message += `⚡ Автовыкуп: ${buyoutPrice} ${auction.data.currency || ''}\n`;
    }

    message += `Минимальный шаг: ${auction.data.minStep || 'не указан'}\n\n` +
      `[🔗 Перейти к аукциону](${auctionLink})\n\n` +
      `Введите вашу ставку (можно с "к"):`;

    await ctx.reply(
      message,
      {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: { force_reply: true }
      }
    );

  } catch (error) {
    console.error('Bid error:', error);
    await ctx.reply('❌ Произошла ошибка');
  }
};

// ============ ПОДПИСАТЬСЯ ============
const handleWatch = async (ctx, auctionId) => {
  const userId = ctx.from.id;

  try {
    const auction = await Auction.findById(auctionId);
    if (!auction) {
      await ctx.reply('❌ Аукцион не найден');
      return;
    }

    if (!auction.watchers) auction.watchers = [];

    if (auction.watchers.includes(userId)) {
      auction.watchers = auction.watchers.filter(id => id !== userId);
      await auction.save();
      await ctx.reply('🔕 Вы отписались от уведомлений об этом аукционе');
    } else {
      auction.watchers.push(userId);
      await auction.save();
      await ctx.reply('🔔 Вы подписались на уведомления об этом аукционе');
    }

  } catch (error) {
    console.error('Watch error:', error);
    await ctx.reply('❌ Произошла ошибка');
  }
};

// ============ ОТМЕНИТЬ СТАВКУ ============
const handleCancelBid = async (ctx, auctionId) => {
  const userId = ctx.from.id;

  try {
    const auction = await Auction.findById(auctionId);
    if (!auction) {
      await ctx.reply('❌ Аукцион не найден');
      return;
    }

    if (auction.status !== 'active') {
      await ctx.reply('❌ Аукцион не активен');
      return;
    }

    if (!auction.currentLeader || auction.currentLeader.userId !== userId) {
      await ctx.reply('❌ Вы не являетесь лидером этого аукциона');
      return;
    }

    const userBids = auction.bids.filter(b => b.userId === userId);
    if (userBids.length === 0) {
      await ctx.reply('❌ У вас нет ставок на этом аукционе');
      return;
    }

    const lastBidIndex = auction.bids.findIndex(b => b.userId === userId);
    if (lastBidIndex !== -1) {
      auction.bids.splice(lastBidIndex, 1);
    }

    if (auction.bids.length > 0) {
      const maxBid = auction.bids.reduce((max, bid) => bid.amount > max.amount ? bid : max);
      auction.currentBid = maxBid.amount;
      auction.currentBidDisplay = maxBid.originalText;
      auction.currentLeader = { userId: maxBid.userId, username: maxBid.username };
    } else {
      auction.currentBid = 0;
      auction.currentBidDisplay = auction.data.startPrice || '0';
      auction.currentLeader = null;
    }

    await auction.save();

    await ctx.reply('✅ Ваша ставка отменена');
    await schedulerService.updateChannelPost(auction);

  } catch (error) {
    console.error('Cancel bid error:', error);
    await ctx.reply('❌ Произошла ошибка при отмене ставки');
  }
};

// ============ АВТОВЫКУП ============
const handleBuyout = async (ctx, auctionId) => {
  const userId = ctx.from.id;

  try {
    const auction = await Auction.findById(auctionId);
    if (!auction) {
      await ctx.reply('❌ Аукцион не найден');
      return;
    }

    if (auction.status !== 'active') {
      await ctx.reply('❌ Аукцион не активен');
      return;
    }

    if (auction.userId === userId) {
      await ctx.reply('❌ Вы не можете выкупить свой собственный аукцион');
      return;
    }

    if (auction.data.autoBuyout !== 'да') {
      await ctx.reply('❌ Автовыкуп недоступен');
      return;
    }

    const user = await User.findOne({ telegramId: userId });
    if (user?.isAuctionBanned) {
      await ctx.reply('❌ Вы заблокированы в аукционах');
      return;
    }

    ctx.session.buyoutAuctionId = auctionId;

    const auctionLink = auction.channelPostUrl || `https://t.me/c/${config.CHANNEL_ID.toString().replace('-100', '')}/${auction.channelMessageId}`;

    await ctx.reply(
      `⚡ *АВТОВЫКУП*\n\n` +
      `Лот: ${auction.data.name || auction.data.species || 'Аукцион'}\n` +
      `Сумма выкупа: ${auction.data.autoBuyoutPrice} ${auction.data.currency || ''}\n\n` +
      `[🔗 Перейти к аукциону](${auctionLink})\n\n` +
      `Вы уверены? Напишите "да" для подтверждения или "нет" для отмены.`,
      {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: { force_reply: true }
      }
    );

  } catch (error) {
    console.error('Buyout error:', error);
    await ctx.reply('❌ Произошла ошибка');
  }
};

// ============ ОБРАБОТЧИК КОМАНД ИЗ URL ============
bot.hears(/^\/start (bid|watch|cancelbid|buyout)_(.+)$/, async (ctx) => {
  const action = ctx.match[1];
  const auctionId = ctx.match[2];

  try { await ctx.deleteMessage(); } catch (e) {}

  if (action === 'bid') {
    await handleBid(ctx, auctionId);
  } else if (action === 'watch') {
    await handleWatch(ctx, auctionId);
  } else if (action === 'cancelbid') {
    await handleCancelBid(ctx, auctionId);
  } else if (action === 'buyout') {
    await handleBuyout(ctx, auctionId);
  }
});

bot.hears(/^bid_(.+)$/, async (ctx) => {
  const auctionId = ctx.match[1];
  try { await ctx.deleteMessage(); } catch (e) {}
  await handleBid(ctx, auctionId);
});

bot.hears(/^watch_(.+)$/, async (ctx) => {
  const auctionId = ctx.match[1];
  try { await ctx.deleteMessage(); } catch (e) {}
  await handleWatch(ctx, auctionId);
});

bot.hears(/^cancelbid_(.+)$/, async (ctx) => {
  const auctionId = ctx.match[1];
  try { await ctx.deleteMessage(); } catch (e) {}
  await handleCancelBid(ctx, auctionId);
});

bot.hears(/^buyout_(.+)$/, async (ctx) => {
  const auctionId = ctx.match[1];
  try { await ctx.deleteMessage(); } catch (e) {}
  await handleBuyout(ctx, auctionId);
});

// ============ ЗАПАСНЫЕ CALLBACK ОБРАБОТЧИКИ ============
bot.action(/^bid_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('⚠️ Нажмите кнопку ещё раз — вы перейдёте в личные сообщения с ботом', { show_alert: true });
});

bot.action(/^watch_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('⚠️ Нажмите кнопку ещё раз — вы перейдёте в личные сообщения с ботом', { show_alert: true });
});

bot.action(/^cancelbid_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('⚠️ Нажмите кнопку ещё раз — вы перейдёте в личные сообщения с ботом', { show_alert: true });
});

bot.action(/^buyout_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('⚠️ Нажмите кнопку ещё раз — вы перейдёте в личные сообщения с ботом', { show_alert: true });
});

// ============ ОБРАБОТЧИК КНОПОК ПОСЛЕ ОТМЕНЫ ============
bot.action(/^change_bid_(.+)$/, async (ctx) => {
  const auctionId = ctx.match[1];
  await ctx.answerCbQuery();
  await ctx.deleteMessage();
  await handleBid(ctx, auctionId);
});

bot.action('cancel_bid_action', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage();
  await ctx.reply('❌ Действие отменено.');
  delete ctx.session.biddingAuctionId;
  delete ctx.session.pendingBuyoutConfirm;
});

// ============ ОБРАБОТКА ВВОДА ПОЛЬЗОВАТЕЛЯ ============
bot.on('text', async (ctx, next) => {
  const biddingAuctionId = ctx.session?.biddingAuctionId;
  const buyoutAuctionId = ctx.session?.buyoutAuctionId;
  const pendingBuyoutConfirm = ctx.session?.pendingBuyoutConfirm;

  if (buyoutAuctionId) {
    const text = ctx.message.text.toLowerCase().trim();

    if (text === 'да' || text === 'yes') {
      await confirmBuyout(ctx, buyoutAuctionId);
    } else if (text === 'нет' || text === 'no') {
      delete ctx.session.buyoutAuctionId;
      await ctx.reply('❌ Автовыкуп отменён');
    } else {
      await ctx.reply('Пожалуйста, ответьте "да" или "нет"');
    }
    return;
  }

  if (pendingBuyoutConfirm) {
    const text = ctx.message.text.toLowerCase().trim();

    if (text === 'да' || text === 'yes') {
      await confirmBuyout(ctx, pendingBuyoutConfirm.auctionId);
      delete ctx.session.pendingBuyoutConfirm;
    } else if (text === 'нет' || text === 'no') {
      const auctionId = pendingBuyoutConfirm.auctionId;
      delete ctx.session.pendingBuyoutConfirm;

      await ctx.reply(
        `❌ Действие отменено. Вы можете сделать ставку меньшую, чем сумма автовыкупа.`,
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('💰 Изменить ставку', `change_bid_${auctionId}`)],
            [Markup.button.callback('❌ Отмена', 'cancel_bid_action')]
          ]).reply_markup
        }
      );
    } else {
      await ctx.reply('Пожалуйста, ответьте "да" или "нет"');
    }
    return;
  }

  if (!biddingAuctionId) {
    return next();
  }

  const text = ctx.message.text;
  const amount = parsePrice(text);

  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('❌ Введите корректную сумму!');
    return;
  }

  try {
    const auction = await Auction.findById(biddingAuctionId);
    if (!auction) {
      await ctx.reply('❌ Аукцион не найден');
      delete ctx.session.biddingAuctionId;
      return;
    }

    const currentBid = auction.currentBid || parsePrice(auction.data.startPrice) || 0;
    const minStep = parsePrice(auction.data.minStep) || 1;

    const hasBuyout = auction.data.autoBuyout === 'да' && auction.data.autoBuyoutPrice;
    let buyoutPrice = 0;

    if (hasBuyout) {
      buyoutPrice = parsePrice(auction.data.autoBuyoutPrice);
    }

    if (hasBuyout && amount >= buyoutPrice) {
      delete ctx.session.biddingAuctionId;

      ctx.session.pendingBuyoutConfirm = { auctionId: biddingAuctionId };

      const auctionLink = auction.channelPostUrl || `https://t.me/c/${config.CHANNEL_ID.toString().replace('-100', '')}/${auction.channelMessageId}`;

      await ctx.reply(
        `⚡ *ВНИМАНИЕ!*\n\n` +
        `Ваша ставка (${text}) равна или превышает сумму автовыкупа (${auction.data.autoBuyoutPrice}).\n\n` +
        `[🔗 Перейти к аукциону](${auctionLink})\n\n` +
        `Вы хотите совершить автовыкуп за ${auction.data.autoBuyoutPrice}?\n\n` +
        `Напишите "да" для автовыкупа или "нет" для отмены.`,
        {
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        }
      );
      return;
    }

    if (amount <= currentBid) {
      await ctx.reply(`❌ Ставка должна быть больше текущей (${auction.currentBidDisplay || currentBid})`);
      return;
    }

    if (amount < currentBid + minStep && currentBid > 0) {
      await ctx.reply(`❌ Минимальный шаг ставки: ${auction.data.minStep || minStep}`);
      return;
    }

    const previousLeader = auction.currentLeader;

    auction.currentBid = amount;
    auction.currentBidDisplay = text;
    auction.currentLeader = { userId: ctx.from.id, username: ctx.from.username };
    auction.bids.push({
      userId: ctx.from.id,
      username: ctx.from.username,
      amount,
      originalText: text,
      timestamp: new Date()
    });
    await auction.save();

    await ctx.reply(`✅ Ваша ставка ${text} принята!`);

    await notificationService.notifyNewBid(auction, previousLeader);
    await schedulerService.updateChannelPost(auction);

    delete ctx.session.biddingAuctionId;

  } catch (error) {
    console.error('Bid processing error:', error);
    await ctx.reply('❌ Произошла ошибка при обработке ставки');
    delete ctx.session.biddingAuctionId;
  }
});

// ============ ПОДТВЕРЖДЕНИЕ АВТОВЫКУПА ============
async function confirmBuyout(ctx, auctionId) {
  const userId = ctx.from.id;

  try {
    const auction = await auctionService.buyoutAuction(auctionId, userId, ctx.from.username);

    const pointsService = require('../../services/points.service');
    await pointsService.awardForPurchase(userId, auction.currentBid);
    await pointsService.awardForSale(auction.userId, auction.currentBid);

    await ctx.reply('🎉 Поздравляем! Вы выкупили лот!');

    await notificationService.notifyAuctionEnded(auction);
    await schedulerService.updateChannelPost(auction);

    delete ctx.session.buyoutAuctionId;
    delete ctx.session.pendingBuyoutConfirm;

  } catch (error) {
    console.error('Confirm buyout error:', error);
    await ctx.reply('❌ ' + error.message);
    delete ctx.session.buyoutAuctionId;
    delete ctx.session.pendingBuyoutConfirm;
  }
}

module.exports = {
  handleBid,
  handleWatch,
  handleCancelBid,
  handleBuyout
};
