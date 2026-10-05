const AuctionDraft = require('../db/models/AuctionDraft');
const Auction = require('../db/models/Auction');
const User = require('../db/models/User');
const config = require('../config');
const { formatHorseTemplate, formatAccessoryTemplate, formatPotionTemplate } = require('../utils/helpers');
const { Markup } = require('telegraf');

class AuctionService {
  constructor() {
    this.bot = null;
  }

  // ✅ Метод для внедрения бота (устранение циклической зависимости)
  setBot(bot) {
    this.bot = bot;
  }

  async findOrCreateUser(telegramId, userData = {}) {
    let user = await User.findOne({ telegramId });

    if (!user) {
      user = await User.create({
        telegramId,
        username: userData.username,
        firstName: userData.first_name,
        lastName: userData.last_name,
        isAdmin: config.ADMIN_IDS.includes(telegramId)
      });
    } else {
      user.username = userData.username || user.username;
      user.firstName = userData.first_name || user.firstName;
      user.lastName = userData.last_name || user.lastName;
      user.updatedAt = new Date();
      await user.save();
    }

    return user;
  }

  async checkExistingDraft(userId) {
    return AuctionDraft.findOne({
      userId,
      status: { $in: ['draft', 'needs_revision'] }
    }).sort({ createdAt: -1 });
  }

  async createDraft(userId, category) {
    return AuctionDraft.create({
      userId,
      category,
      data: {},
      status: 'draft'
    });
  }

  async updateDraft(draftId, data) {
    const draft = await AuctionDraft.findById(draftId);
    if (!draft) throw new Error('Draft not found');

    draft.data = { ...draft.data, ...data };
    draft.expiresAt = new Date(Date.now() + config.DRAFT_EXPIRY_HOURS * 60 * 60 * 1000);
    await draft.save();

    return draft;
  }

  async submitForReview(draftId) {
    const draft = await AuctionDraft.findById(draftId);
    if (!draft) throw new Error('Draft not found');

    draft.status = 'pending_review';
    await draft.save();

    return draft;
  }

  async approveAuction(draftId, adminId) {
    const draft = await AuctionDraft.findById(draftId);
    if (!draft) throw new Error('Draft not found');

    const auction = await Auction.create({
      draftId: draft._id,
      userId: draft.userId,
      category: draft.category,
      data: draft.data,
      photos: draft.data.photos || [],
      endDate: draft.data.endDate,
      approvedByAdminId: adminId,
      publishedAt: new Date(),
      status: 'active'
    });

    try {
      await this.publishAuctionToChannel(auction);
    } catch (error) {
      console.error('Failed to publish auction to channel:', error);
    }

    draft.status = 'approved';
    await draft.save();

    return auction;
  }

  async publishAuctionToChannel(auction) {
    if (!this.bot) {
      throw new Error('Bot not initialized in AuctionService. Call setBot() first.');
    }

    const seller = await User.findOne({ telegramId: auction.userId });
    const sellerInfo = seller
      ? { username: seller.username, telegramId: seller.telegramId }
      : null;
    const displayBid = auction.data.startPrice || '0';

    let template;
    if (auction.category === 'horse') {
      template = formatHorseTemplate({ ...auction.data, currentBid: displayBid, leader: '________' }, sellerInfo, true);
    } else if (auction.category === 'accessory') {
      template = formatAccessoryTemplate({ ...auction.data, currentBid: displayBid, leader: '________' }, sellerInfo, true);
    } else {
      template = formatPotionTemplate({ ...auction.data, currentBid: displayBid, leader: '________' }, sellerInfo, true);
    }

    const botUsername = (await this.bot.telegram.getMe()).username;

    const buttons = [
      [Markup.button.url('💰 Ставка', `https://t.me/${botUsername}?start=bid_${auction._id}`)],
      [Markup.button.url('🔔 Отслеживать', `https://t.me/${botUsername}?start=watch_${auction._id}`)]
    ];

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

    const keyboard = Markup.inlineKeyboard(buttons);

    let channelMessage;

    if (auction.data.mainPhoto) {
      channelMessage = await this.bot.telegram.sendPhoto(
        config.CHANNEL_ID,
        auction.data.mainPhoto,
        {
          caption: template,
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup
        }
      );
    } else {
      channelMessage = await this.bot.telegram.sendMessage(
        config.CHANNEL_ID,
        template,
        {
          parse_mode: 'HTML',
          reply_markup: keyboard.reply_markup
        }
      );
    }

    auction.channelMessageId = channelMessage.message_id;

    const chatId = config.CHANNEL_ID.toString().replace('-100', '');
    auction.channelPostUrl = `https://t.me/c/${chatId}/${channelMessage.message_id}`;

    await auction.save();

    console.log(`Auction ${auction._id} published to channel, message ID: ${channelMessage.message_id}`);

    return channelMessage;
  }

  async rejectAuction(draftId) {
    await AuctionDraft.findByIdAndDelete(draftId);
  }

  // ✅ Основной метод
  async sendForRevision(draftId, comment) {
    const draft = await AuctionDraft.findById(draftId);
    if (!draft) throw new Error('Draft not found');

    draft.status = 'needs_revision';
    draft.revisionComment = comment || null;
    await draft.save();

    return draft;
  }

  // ✅ Алиас — чтобы admin.js мог вызывать sendToRevision
  async sendToRevision(draftId, comment) {
    return this.sendForRevision(draftId, comment);
  }

  async cancelDraft(draftId) {
    await AuctionDraft.findByIdAndDelete(draftId);
  }

  async placeBid(auctionId, userId, username, amount, originalText) {
    const auction = await Auction.findById(auctionId);
    if (!auction) throw new Error('Аукцион не найден');

    if (auction.status !== 'active') throw new Error('Аукцион не активен');
    if (auction.userId === userId) throw new Error('Продавец не может делать ставки');

    const currentBid = auction.currentBid || 0;
    if (amount <= currentBid) throw new Error('Ставка должна быть больше текущей');

    auction.currentBid = amount;
    auction.currentBidDisplay = originalText;
    auction.currentLeader = { userId, username };
    auction.bids.push({ userId, username, amount, originalText });

    await auction.save();

    try {
      const schedulerService = require('./scheduler.service');
      await schedulerService.updateChannelPost(auction);
    } catch (e) {
      console.error('Failed to update channel post after bid:', e.message);
    }

    return auction;
  }

  async buyoutAuction(auctionId, userId, username) {
    const auction = await Auction.findById(auctionId);
    if (!auction) throw new Error('Аукцион не найден');

    if (auction.status !== 'active') throw new Error('Аукцион не активен');
    if (auction.userId === userId) throw new Error('Продавец не может выкупить свой аукцион');
    if (auction.data.autoBuyout !== 'да') throw new Error('Автовыкуп недоступен');

    const buyoutPriceDisplay = auction.data.autoBuyoutPrice;
    const buyoutPrice = parseFloat(buyoutPriceDisplay.replace(/[кk]/g, '000').replace(/[^\d.]/g, '')) || 0;

    auction.status = 'ended';
    auction.endedBy = 'buyout';
    auction.currentBid = buyoutPrice;
    auction.currentBidDisplay = buyoutPriceDisplay;
    auction.currentLeader = { userId, username };

    await auction.save();

    try {
      const schedulerService = require('./scheduler.service');
      await schedulerService.updateChannelPost(auction);
    } catch (e) {
      console.error('Failed to update channel post after buyout:', e.message);
    }

    return auction;
  }

  async endAuction(auctionId, endedBy = 'auto') {
    const auction = await Auction.findById(auctionId);
    if (!auction) throw new Error('Аукцион не найден');

    auction.status = 'ended';
    auction.endedBy = endedBy;

    await auction.save();

    return auction;
  }

  async getUserAuctions(userId, status = null) {
    const query = { userId };
    if (status) query.status = status;

    return Auction.find(query).sort({ createdAt: -1 });
  }

  async getUserParticipations(userId) {
    return Auction.find({
      'bids.userId': userId,
      status: 'active'
    }).sort({ endDate: 1 });
  }

  async getActiveAuctions() {
    return Auction.find({
      status: 'active',
      endDate: { $gt: new Date() }
    });
  }

  async checkEndedAuctions() {
    const endedAuctions = await Auction.find({
      status: 'active',
      endDate: { $lte: new Date() }
    });

    for (const auction of endedAuctions) {
      await this.endAuction(auction._id, 'auto');
    }

    return endedAuctions;
  }
}

module.exports = new AuctionService();