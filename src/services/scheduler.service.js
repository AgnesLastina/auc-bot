const cron = require('node-cron');
const auctionService = require('./auction.service');
const notificationService = require('./notification.service');
const logger = require('../utils/logger');
const config = require('../config');
const User = require('../db/models/User');
const AuctionDraft = require('../db/models/AuctionDraft');
const { Markup } = require('telegraf');
const { formatHorseTemplate, formatAccessoryTemplate, formatPotionTemplate } = require('../utils/helpers');

class SchedulerService {
  constructor() {
    this.jobs = [];
    this.bot = null;
  }

  // ✅ Метод для внедрения бота
  setBot(bot) {
    this.bot = bot;
  }

  start() {
    const job1 = cron.schedule('*/30 * * * * *', async () => {
      try {
        await this.checkEndedAuctions();
      } catch (error) {
        logger.error('Scheduler error:', error);
      }
    });

    const job2 = cron.schedule('0 * * * *', async () => {
      try {
        await this.checkExpiredBans();
      } catch (error) {
        logger.error('Ban check error:', error);
      }
    });

    const job3 = cron.schedule('*/5 * * * *', async () => {
      try {
        const bannedUsers = await User.find({ isAuctionBanned: true }).distinct('telegramId');
        await AuctionDraft.deleteMany({
          userId: { $in: bannedUsers },
          status: 'pending_review'
        });
        logger.info('Drafts cleanup completed');
      } catch (error) {
        logger.error('Draft cleanup error:', error);
      }
    });

    this.jobs.push(job1, job2, job3);
    logger.info('Scheduler started');
  }

  stop() {
    this.jobs.forEach(job => job.stop());
    logger.info('Scheduler stopped');
  }

  async checkEndedAuctions() {
    const endedAuctions = await auctionService.checkEndedAuctions();
    for (const auction of endedAuctions) {
      await this.handleEndedAuction(auction);
    }
  }

  async checkExpiredBans() {
    const users = await User.find({
      isAuctionBanned: true,
      auctionBanUntil: { $lte: new Date(), $ne: null }
    });

    for (const user of users) {
      user.isAuctionBanned = false;
      user.auctionBanReason = null;
      user.auctionBanUntil = null;
      await user.save();

      try {
        if (this.bot) {
          await this.bot.telegram.sendMessage(
            user.telegramId,
            '✅ Срок вашей блокировки истёк. Вы снова можете создавать аукционы и участвовать в ставках!'
          );
        }
      } catch (e) {}

      logger.info(`User ${user.telegramId} unbanned automatically`);
    }
  }

  async handleEndedAuction(auction) {
    try {
      if (auction.channelMessageId) {
        await this.updateChannelPost(auction);
      }

      await notificationService.notifyAuctionEnded(auction);

      const pointsService = require('./points.service');
      if (auction.currentLeader) {
        await pointsService.awardForSale(auction.userId, auction.currentBid);
        await pointsService.awardForPurchase(auction.currentLeader.userId, auction.currentBid);
      }

      logger.info(`Auction ${auction._id} ended automatically`);
    } catch (error) {
      logger.error(`Failed to handle ended auction ${auction._id}:`, error);
    }
  }

  async updateChannelPost(auction) {
    if (!this.bot) {
      logger.error('Bot not initialized in SchedulerService. Call setBot() first.');
      return;
    }

    console.log('Updating channel post. channelMessageId:', auction.channelMessageId, 'auctionId:', auction._id);

    const seller = await User.findOne({ telegramId: auction.userId });
    const sellerInfo = seller
      ? { username: seller.username, telegramId: seller.telegramId }
      : null;
    const displayBid = auction.currentBidDisplay || auction.currentBid || auction.data.startPrice || '0';
    const leader = auction.currentLeader
      ? `@${auction.currentLeader.username || 'нет'} (${auction.currentLeader.userId})`
      : '________';

    let template;
    if (auction.category === 'horse') {
      template = formatHorseTemplate({ ...auction.data, currentBid: displayBid, leader }, sellerInfo, true);
    } else if (auction.category === 'accessory') {
      template = formatAccessoryTemplate({ ...auction.data, currentBid: displayBid, leader }, sellerInfo, true);
    } else {
      template = formatPotionTemplate({ ...auction.data, currentBid: displayBid, leader }, sellerInfo, true);
    }

    let fullText = template;

    if (auction.status === 'ended' || auction.status === 'cancelled') {
      if (auction.currentLeader) {
        fullText += `\n\n🏆 *Аукцион завершён*\n\nПобедитель: @${auction.currentLeader.username || 'нет'} (${auction.currentLeader.userId})\nФинальная ставка: ${displayBid}`;
      } else {
        fullText += `\n\n❌ *Аукцион завершён без ставок*`;
      }
    }

    const botUsername = (await this.bot.telegram.getMe()).username;

    const buttons = [];

    if (auction.status === 'active') {
      buttons.push([Markup.button.url('💰 Ставка', `https://t.me/${botUsername}?start=bid_${auction._id}`)]);
      buttons.push([Markup.button.url('🔔 Отслеживать', `https://t.me/${botUsername}?start=watch_${auction._id}`)]);

      if (auction.data.autoBuyout === 'да' && auction.data.autoBuyoutPrice) {
        buttons.push([
          Markup.button.url(
            `⚡ Выкупить (${auction.data.autoBuyoutPrice})`,
            `https://t.me/${botUsername}?start=buyout_${auction._id}`
          )
        ]);
      }

      if (auction.category === 'horse' && auction.data.paramPhotos && auction.data.paramPhotos.length > 0) {
        buttons.push([
          Markup.button.url('📋 Параметры', `https://t.me/${botUsername}?start=params_${auction._id}`)
        ]);
      }
    } else {
      if (auction.category === 'horse' && auction.data.paramPhotos && auction.data.paramPhotos.length > 0) {
        buttons.push([
          Markup.button.url('📋 Параметры', `https://t.me/${botUsername}?start=params_${auction._id}`)
        ]);
      }
    }

    const keyboard = Markup.inlineKeyboard(buttons);

    if (auction.data.mainPhoto) {
      try {
        await this.bot.telegram.editMessageCaption(
          config.CHANNEL_ID,
          auction.channelMessageId,
          null,
          fullText,
          { parse_mode: 'HTML', reply_markup: keyboard.reply_markup }
        );
        logger.info(`Channel post caption updated for auction ${auction._id}`);
      } catch (e) {
        logger.error(`Failed to edit caption: ${e.message}. Recreating post...`);

        try {
          await this.bot.telegram.deleteMessage(config.CHANNEL_ID, auction.channelMessageId).catch(() => {});

          const newMsg = await this.bot.telegram.sendPhoto(config.CHANNEL_ID, auction.data.mainPhoto, {
            caption: fullText,
            parse_mode: 'HTML',
            reply_markup: keyboard.reply_markup
          });

          auction.channelMessageId = newMsg.message_id;

          const chatId = config.CHANNEL_ID.toString().replace('-100', '');
          auction.channelPostUrl = `https://t.me/c/${chatId}/${newMsg.message_id}`;

          await auction.save();
          logger.info(`Channel post recreated with photo, new ID: ${newMsg.message_id}`);
        } catch (e2) {
          logger.error(`Failed to recreate photo post: ${e2.message}`);
        }
      }
    } else {
      try {
        await this.bot.telegram.editMessageText(
          config.CHANNEL_ID,
          auction.channelMessageId,
          null,
          fullText,
          { parse_mode: 'HTML', reply_markup: keyboard.reply_markup }
        );
        logger.info(`Channel post text updated for auction ${auction._id}`);
      } catch (e) {
        logger.error(`Failed to edit text: ${e.message}. Recreating post...`);

        try {
          await this.bot.telegram.deleteMessage(config.CHANNEL_ID, auction.channelMessageId).catch(() => {});

          const newMsg = await this.bot.telegram.sendMessage(config.CHANNEL_ID, fullText, {
            parse_mode: 'HTML',
            reply_markup: keyboard.reply_markup
          });

          auction.channelMessageId = newMsg.message_id;

          const chatId = config.CHANNEL_ID.toString().replace('-100', '');
          auction.channelPostUrl = `https://t.me/c/${chatId}/${newMsg.message_id}`;

          await auction.save();
          logger.info(`Channel post recreated without photo, new ID: ${newMsg.message_id}`);
        } catch (e2) {
          logger.error(`Failed to recreate text post: ${e2.message}`);
        }
      }
    }
  }
}

module.exports = new SchedulerService();