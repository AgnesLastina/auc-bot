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

const lastBotMsgId = new Map();
const isAdmin = (ctx) => config.ADMIN_IDS.includes(ctx.from?.id);

async function replyWithKeyboard(ctx, text, extra = {}) {
  const uid = ctx.from?.id;
  if (!extra.reply_markup) extra.reply_markup = keyboards.mainMenuKeyboard(isAdmin(ctx)).reply_markup;
  const prevId = lastBotMsgId.get(uid);
  if (prevId) try { await ctx.telegram.deleteMessage(ctx.chat.id, prevId); } catch (e) {}
  const msg = await ctx.telegram.sendMessage(ctx.chat.id, text, extra);
  lastBotMsgId.set(uid, msg.message_id);
  return msg;
}

async function getAdminPanelText(username) {
  const [pendingDrafts, activeAuctions, bannedUsers] = await Promise.all([
    AuctionDraft.countDocuments({ status: 'pending_review' }),
    Auction.countDocuments({ status: 'active' }),
    User.countDocuments({ isAuctionBanned: true })
  ]);
  return `👑 Админ-панель\n\nДобро пожаловать, @${username || 'админ'}!\n\n📊 Статистика:\n📝 Ожидают проверки: ${pendingDrafts}\n🟢 Активных аукционов: ${activeAuctions}\n🚫 Заблокированных: ${bannedUsers}\n\nИспользуйте кнопки ниже:`;
}

bot.use(async (ctx, next) => {
  const txt = ctx.message?.text;
  if (txt && ctx.from?.id) {
    const cmds = ['🛒 Создать аукцион', '📋 Мои аукционы', '🎯 Активные участия', '👤 Профиль', '🔔 Настройки уведомлений', '🆘 Поддержка / Спор', '👑 Админ-панель', '👤 Обычное меню', '📝 Ожидают проверки', '🟢 Активные аукционы', '🚫 Заблокированные', '📋 Логи модерации', '⚙️ Настройки бота', '🏆 Рейтинг', '💰 Баланс', '/start', '/status'];
    if (cmds.includes(txt)) setTimeout(async () => { try { await ctx.deleteMessage(); } catch (e) {} }, 500);
  }
  return next();
});

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const payload = ctx.startPayload;

  if (payload) {
    const [action, ...idParts] = payload.split('_');
    const auctionId = idParts.join('_');
    const bids = require('../handlers/bids');
    if (action === 'bid') return bids.handleBid(ctx, auctionId);
    if (action === 'watch') return bids.handleWatch(ctx, auctionId);
    if (action === 'cancelbid') return bids.handleCancelBid(ctx, auctionId);
    if (action === 'buyout') return bids.handleBuyout(ctx, auctionId);
    if (action === 'params') return handleShowParams(ctx, auctionId);
  }

  if (isAdmin(ctx)) return replyWithKeyboard(ctx, await getAdminPanelText(ctx.from.username), keyboards.adminPanelKeyboard());

  await auctionService.findOrCreateUser(userId, ctx.from);
  const welcome = `༅༄࿓ Добро пожаловать в LUNALO!\n\nЗакрепите сообщение и используйте команду /start, если кнопки исчезнут!\n\nПожалуйста, сообщайте Агнес, если:\n• Пропала клавиатура\n• Возникла ошибка\n\nИспользуйте кнопки ниже.`;
  await replyWithKeyboard(ctx, welcome);
});

bot.hears('🛒 Создать аукцион', async (ctx) => {
  try { await require('../handlers/drafts').showDraftsList(ctx, ctx.from.id); } catch (e) { await ctx.reply('❌ Ошибка. Попробуйте позже.'); }
});

async function getSettingsText() {
  const s = await settingsService.get();
  const mode = s.publishMode === 'auto' ? '🚀 *АВТО-публикация*' : '👮 *РУЧНАЯ публикация*';
  const verify = s.autoVerify ? '✅ *Проверка фото ВКЛ*' : '❌ *Проверка фото ВЫКЛ*';
  return `⚙️ *Настройки бота*\n\n${mode}\n${verify}\n\nНажмите на кнопку:`;
}

bot.hears('⚙️ Настройки бота', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const s = await settingsService.get();
  const msg = await ctx.reply(await getSettingsText(), { parse_mode: 'Markdown', ...keyboards.botSettingsKeyboard(s) });
  lastBotMsgId.set(ctx.from.id, msg.message_id);
});

bot.action('settings_toggle_publish', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Доступ запрещён');
  const s = await settingsService.get();
  await settingsService.setPublishMode(s.publishMode === 'auto' ? 'manual' : 'auto', ctx.from.id);
  const u = await settingsService.get();
  await ctx.editMessageText(await getSettingsText(), { parse_mode: 'Markdown', ...keyboards.botSettingsKeyboard(u) }).catch(()=>{});
  await ctx.answerCbQuery('Режим изменён');
});

bot.action('settings_toggle_verify', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Доступ запрещён');
  const s = await settingsService.get();
  await settingsService.setAutoVerify(!s.autoVerify, ctx.from.id);
  const u = await settingsService.get();
  await ctx.editMessageText(await getSettingsText(), { parse_mode: 'Markdown', ...keyboards.botSettingsKeyboard(u) }).catch(()=>{});
  await ctx.answerCbQuery('Проверка изменена');
});

bot.action('settings_back', async (ctx) => {
  await ctx.answerCbQuery(); await ctx.deleteMessage();
  await replyWithKeyboard(ctx, await getAdminPanelText(ctx.from.username), keyboards.adminPanelKeyboard());
});

bot.hears('📋 Мои аукционы', async (ctx) => {
  try {
    const auctions = await Auction.find({ userId: ctx.from.id, status: 'active' }).sort({ createdAt: -1 });
    if (!auctions.length) {
      const msg = await ctx.reply('У вас нет активных аукционов.\n\nНо вы можете посмотреть шаблоны:', Markup.inlineKeyboard([[Markup.button.callback('📁 Шаблоны', 'show_templates')], [Markup.button.callback('❌ Закрыть', 'close_my_auctions')]]));
      return lastBotMsgId.set(ctx.from.id, msg.message_id);
    }
    let message = '📋 *Ваши активные аукционы:*\n\n';
    const auctionMap = {}; let idx = 1;
    for (const cat of ['horse', 'accessory', 'potion']) {
      const list = auctions.filter(a => a.category === cat);
      if (!list.length) continue;
      const title = cat === 'horse' ? '🎠 *Лошадь*' : cat === 'accessory' ? '👘 *Аксессуар*' : '🍷 *Зелье*';
      message += `${title}:\n\n`;
      for (const a of list) {
        const bid = a.currentBidDisplay || a.currentBid || a.data.startPrice || '0';
        auctionMap[idx] = a._id.toString();
        message += `${idx}. 🟢 ${a.data.species || a.data.name || 'Неизвестно'}\n   Ставка: ${bid} ${a.data.currency || ''}\n   ID: #${a._id.toString().slice(-6)}\n\n`;
        idx++;
      }
    }
    ctx.session.myAuctionsMap = auctionMap;
    await replyWithKeyboard(ctx, message, { parse_mode: 'Markdown', disable_web_page_preview: true, ...Markup.inlineKeyboard([[Markup.button.callback('📌 Выбрать', 'select_my_auction')], [Markup.button.callback('📁 Шаблоны', 'show_templates')], [Markup.button.callback('❌ Закрыть', 'close_my_auctions')]]) });
  } catch (e) { await replyWithKeyboard(ctx, 'Произошла ошибка.'); }
});

bot.action('close_my_auctions', async (ctx) => {
  await ctx.answerCbQuery(); await ctx.deleteMessage();
  await replyWithKeyboard(ctx, '📋 Главное меню', keyboards.mainMenuKeyboard(isAdmin(ctx)));
});

bot.action('select_my_auction', async (ctx) => {
  await ctx.answerCbQuery(); try { await ctx.deleteMessage(); } catch (e) {}
  const count = Object.keys(ctx.session?.myAuctionsMap || {}).length;
  if (!count) return replyWithKeyboard(ctx, 'У вас нет активных аукционов.');
  const buttons = [];
  for (let i = 1; i <= count; i++) buttons.push([Markup.button.callback(`${i}`, `my_auction_${i}`)]);
  buttons.push([Markup.button.callback('❌ Закрыть', 'close_my_auctions')]);
  const msg = await ctx.reply('Выберите номер аукциона:', Markup.inlineKeyboard(buttons));
  lastBotMsgId.set(ctx.from.id, msg.message_id);
});

bot.action(/^my_auction_(\d+)$/, async (ctx) => {
  const id = (ctx.session?.myAuctionsMap || {})[parseInt(ctx.match[1])];
  await ctx.answerCbQuery(); try { await ctx.deleteMessage(); } catch (e) {}
  if (!id) return replyWithKeyboard(ctx, '❌ Не найден');
  const a = await Auction.findById(id);
  if (!a) return replyWithKeyboard(ctx, '❌ Не найден');
  const bid = a.currentBidDisplay || a.currentBid || a.data.startPrice || '0';
  const link = a.channelPostUrl || `https://t.me/c/${config.CHANNEL_ID.toString().replace('-100', '')}/${a.channelMessageId}`;
  let text = `📋 *Аукцион #${a._id.toString().slice(-6)}*\n\nЛот: ${a.data.name || a.data.species || 'Неизвестно'}\nТекущая ставка: ${bid} ${a.data.currency || ''}\nСтатус: ${a.status}\n\n[🔗 Перейти](${link})`;
  const btns = [[Markup.button.callback('❌ Отменить аукцион', `cancel_my_auction_${a._id}`)]];
  if (a.data.earlyEnd === 'да' && a.status === 'active' && a.bids?.length > 0) btns.push([Markup.button.callback('⏰ Завершить досрочно', `early_end_auction_${a._id}`)]);
  btns.push([Markup.button.callback('◀️ Назад', 'select_my_auction')], [Markup.button.callback('❌ Закрыть', 'close_my_auctions')]);
  const msg = await ctx.reply(text, { parse_mode: 'Markdown', disable_web_page_preview: true, ...Markup.inlineKeyboard(btns) });
  lastBotMsgId.set(ctx.from.id, msg.message_id);
  ctx.session.myAuctionIndex = parseInt(ctx.match[1]);
});

bot.action(/^cancel_my_auction_(.+)$/, async (ctx) => {
  const a = await Auction.findById(ctx.match[1]);
  await ctx.answerCbQuery(); try { await ctx.deleteMessage(); } catch (e) {}
  if (!a) return replyWithKeyboard(ctx, '❌ Не найден');
  let text = `📋 *Отмена аукциона*\n\nНа этом аукционе нет ставок.\nОтмена пройдёт без штрафа.\n\nВы уверены?`;
  if (a.bids?.length > 0) {
    const uniqueBidders = [...new Set(a.bids.map(b => b.userId))];
    const names = await Promise.all(uniqueBidders.map(async uid => `@${(await User.findOne({ telegramId: uid }))?.username || uid}`));
    const banDate = moment(Date.now() + 7 * 24 * 60 * 60 * 1000).format('DD.MM.YYYY в HH:mm');
    text = `⚠️ *ВНИМАНИЕ!*\n\nВы собираетесь отменить аукцион:\n📊 Ставок: *${a.bids.length}*\n👥 Участников: *${uniqueBidders.length}*\n👤 Участники: ${names.join(', ')}\n\n*ШТРАФ:*\n🚫 Запрет на создание аукционов\n🚫 Запрет на участие\n⏰ Срок: 7 дней (до ${banDate})\n\nВы уверены?`;
  }
  const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback(a.bids?.length > 0 ? '✅ Да, отменить (штраф)' : '✅ Да, отменить', `confirm_cancel_auction_${a._id}`)], [Markup.button.callback('❌ Нет', `my_auction_${ctx.session.myAuctionIndex || 1}`)]]) });
  lastBotMsgId.set(ctx.from.id, msg.message_id);
});

bot.action(/^confirm_cancel_auction_(.+)$/, async (ctx) => {
  const a = await Auction.findById(ctx.match[1]);
  await ctx.answerCbQuery(); try { await ctx.deleteMessage(); } catch (e) {}
  if (!a) return replyWithKeyboard(ctx, '❌ Не найден');
  if (a.bids?.length > 0) await User.updateOne({ telegramId: a.userId }, { isAuctionBanned: true, auctionBanReason: 'Отмена со ставками', auctionBanUntil: new Date(Date.now() + 7*24*60*60*1000) });
  a.status = 'cancelled'; await a.save();
  await schedulerService.updateChannelPost(a);
  await replyWithKeyboard(ctx, '✅ Аукцион отменён.');
});

bot.action(/^early_end_auction_(.+)$/, async (ctx) => {
  const a = await Auction.findById(ctx.match[1]);
  await ctx.answerCbQuery(); try { await ctx.deleteMessage(); } catch (e) {}
  if (!a) return replyWithKeyboard(ctx, '❌ Не найден');
  if (!a.currentLeader) return replyWithKeyboard(ctx, '❌ Нет ставок');
  a.status = 'ended'; a.endedBy = 'seller'; await a.save();
  await schedulerService.updateChannelPost(a);
  await require('../../services/notification.service').notifyAuctionEnded(a);
  await replyWithKeyboard(ctx, '✅ Аукцион завершён досрочно.');
});

bot.hears('🎯 Активные участия', async (ctx) => {
  try {
    const parts = await Auction.find({ 'bids.userId': ctx.from.id, status: 'active' }).sort({ endDate: 1 });
    if (!parts.length) return replyWithKeyboard(ctx, 'Вы пока не участвуете ни в одном аукционе.');
    let message = '🎯 *Ваши активные участия:*\n\n';
    const map = {}; let idx = 1;
    for (const a of parts) {
      const myBid = a.bids.filter(b => b.userId === ctx.from.id).sort((x,y)=>y.amount-x.amount)[0];
      const isLead = a.currentLeader?.userId === ctx.from.id;
      map[idx] = a._id.toString();
      message += `${idx}. ${isLead ? '👑' : '💰'} ${a.data.name || a.data.species || 'Аукцион'}\n   Ваша ставка: ${myBid?.originalText || myBid?.amount || 0}\n   Текущая: ${a.currentBidDisplay || a.currentBid || a.data.startPrice || '0'} ${a.data.currency || ''}\n   ID: #${a._id.toString().slice(-6)}\n\n`;
      idx++;
    }
    ctx.session.participationMap = map;
    await replyWithKeyboard(ctx, message, { parse_mode: 'Markdown', disable_web_page_preview: true, ...Markup.inlineKeyboard([[Markup.button.callback('📌 Выбрать', 'select_participation')]]) });
  } catch (e) { await replyWithKeyboard(ctx, 'Ошибка.'); }
});

bot.action('select_participation', async (ctx) => {
  await ctx.answerCbQuery(); try { await ctx.deleteMessage(); } catch (e) {}
  const count = Object.keys(ctx.session?.participationMap || {}).length;
  if (!count) return replyWithKeyboard(ctx, 'Нет участий.');
  const btns = [];
  for (let i = 1; i <= count; i++) btns.push([Markup.button.callback(`${i}`, `participation_${i}`)]);
  btns.push([Markup.button.callback('◀️ Назад', 'back_to_main')]);
  const msg = await ctx.reply('Выберите номер:', Markup.inlineKeyboard(btns));
  lastBotMsgId.set(ctx.from.id, msg.message_id);
});

bot.action(/^participation_(\d+)$/, async (ctx) => {
  const id = (ctx.session?.participationMap || {})[parseInt(ctx.match[1])];
  await ctx.answerCbQuery(); try { await ctx.deleteMessage(); } catch (e) {}
  if (!id) return replyWithKeyboard(ctx, '❌ Не найден');
  const a = await Auction.findById(id);
  if (!a) return replyWithKeyboard(ctx, '❌ Не найден');
  let text = `💰 *СТАВКА*\n\nЛот: ${a.data.name || a.data.species || 'Аукцион'}\nТекущая ставка: ${a.currentBidDisplay || a.currentBid || a.data.startPrice || '0'} ${a.data.currency || ''}\n`;
  if (a.data.autoBuyout === 'да' && a.data.autoBuyoutPrice) text += `⚡ Автовыкуп: ${a.data.autoBuyoutPrice} ${a.data.currency || ''}\n`;
  text += `Минимальный шаг: ${a.data.minStep || 'не указан'}\n`;
  ctx.session.selectedParticipationId = id;
  const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отменить ставку', `cancel_bid_from_participation_${id}`)], [Markup.button.callback('🔔 Подписаться', `watch_from_participation_${id}`)]]) });
  lastBotMsgId.set(ctx.from.id, msg.message_id);
});

bot.action(/^cancel_bid_from_participation_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery(); await ctx.deleteMessage();
  await require('../handlers/bids').handleCancelBid(ctx, ctx.match[1]);
});

bot.action(/^watch_from_participation_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery(); await ctx.deleteMessage();
  await require('../handlers/bids').handleWatch(ctx, ctx.match[1]);
});

bot.hears('👤 Профиль', async (ctx) => {
  try {
    const u = await auctionService.findOrCreateUser(ctx.from.id, ctx.from);
    const banInfo = u.isAuctionBanned && u.auctionBanUntil ? `\n⏰ Разбан: ${moment(u.auctionBanUntil).format('DD.MM.YYYY HH:mm')}` : '';
    const msg = `<b>👤 Профиль</b>\n\n🆔 ID: <code>${u.telegramId}</code>\n📛 Username: @${u.username || 'не указан'}\n👋 Имя: ${u.firstName || ''} ${u.lastName || ''}\n📅 Регистрация: ${moment(u.createdAt).format('DD.MM.YYYY')}\n🚫 Статус: ${u.isAuctionBanned ? '❌ Заблокирован' : '✅ Активен'}${banInfo}`;
    await replyWithKeyboard(ctx, msg, { parse_mode: 'HTML' });
  } catch (e) { await replyWithKeyboard(ctx, 'Ошибка.'); }
});

bot.command('status', async (ctx) => {
  if (!isAdmin(ctx)) return replyWithKeyboard(ctx, '⛔ Отказано');
  const health = require('../../services/health.service');
  const s = health.getStatus(), stats = await health.getStats();
  await replyWithKeyboard(ctx, `📊 *Bot Status*\n\n✅ Status: ${s.healthy ? 'Healthy' : 'Issues'}\n⏱ Uptime: ${s.uptime}\n🗄 DB: ${s.dbConnected ? 'OK' : 'Fail'}\n⚠️ Errors: ${s.errors}\n\n📈 *Stats*\n🟢 Auctions: ${stats.activeAuctions}\n📝 Pending: ${stats.pendingDrafts}\n🚫 Banned: ${stats.bannedUsers}\n👥 Users: ${stats.totalUsers}`, { parse_mode: 'Markdown' });
});

bot.hears('🔔 Настройки уведомлений', async (ctx) => {
  try {
    const u = await User.findOne({ telegramId: ctx.from.id });
    const status = u?.notificationsEnabled ? 'включены' : 'выключены';
    const prev = lastBotMsgId.get(ctx.from.id); if (prev) try { await ctx.telegram.deleteMessage(ctx.chat.id, prev); } catch(e){}
    const msg = await ctx.reply(`🔔 *Настройки*\n\nТекущий статус: ${status}\n\nВыберите действие:`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('✅ Включить', 'notify_on')], [Markup.button.callback('❌ Выключить', 'notify_off')], [Markup.button.callback('❌ Закрыть', 'close_notify')]]) });
    lastBotMsgId.set(ctx.from.id, msg.message_id);
  } catch (e) { await replyWithKeyboard(ctx, 'Ошибка.'); }
});

bot.action('close_notify', async (ctx) => { await ctx.answerCbQuery(); await ctx.deleteMessage(); await replyWithKeyboard(ctx, '📋 Главное меню', keyboards.mainMenuKeyboard(isAdmin(ctx))); });
bot.action('notify_on', async (ctx) => { await User.updateOne({ telegramId: ctx.from.id }, { notificationsEnabled: true }); await ctx.answerCbQuery('Включено'); await ctx.deleteMessage(); await replyWithKeyboard(ctx, '🔔 Уведомления *включены*', { parse_mode: 'Markdown' }); });
bot.action('notify_off', async (ctx) => { await User.updateOne({ telegramId: ctx.from.id }, { notificationsEnabled: false }); await ctx.answerCbQuery('Выключено'); await ctx.deleteMessage(); await replyWithKeyboard(ctx, '🔕 Уведомления *выключены*', { parse_mode: 'Markdown' }); });
bot.action('back_to_main', async (ctx) => { await ctx.answerCbQuery(); await ctx.deleteMessage(); await replyWithKeyboard(ctx, '📋 Главное меню', keyboards.mainMenuKeyboard(isAdmin(ctx))); });

bot.hears('🆘 Поддержка / Спор', async (ctx) => {
  await replyWithKeyboard(ctx, `🆘 Поддержка\n\nПо вопросам пишите:\nt.me/HL_auctions?direct\n\nОпишите ситуацию и приложите ID аукциона.`);
});

bot.hears('📝 Ожидают проверки', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const banned = await User.find({ isAuctionBanned: true }).distinct('telegramId');
  if (banned.length) await AuctionDraft.deleteMany({ userId: { $in: banned }, status: 'pending_review' });
  const pending = await AuctionDraft.find({ status: 'pending_review' }).sort({ createdAt: -1 }).limit(20);
  if (!pending.length) return replyWithKeyboard(ctx, 'Нет аукционов на проверке.', keyboards.adminPanelKeyboard());
  let msg = '📝 *На проверке:*\n\n';
  for (const d of pending) {
    const u = await User.findOne({ telegramId: d.userId });
    msg += `🆔 #${d._id.toString().slice(-6)}\n📦 ${d.category === 'horse' ? 'Лошадь' : d.category === 'accessory' ? 'Аксессуар' : 'Зелье'}\n👤 @${u?.username || 'нет'} | ${d.userId}\n\n`;
  }
  await replyWithKeyboard(ctx, msg, { parse_mode: 'Markdown', ...keyboards.adminPanelKeyboard() });
});

bot.hears('👑 Админ-панель', async (ctx) => {
  if (!isAdmin(ctx)) return replyWithKeyboard(ctx, '⛔ Отказано');
  await replyWithKeyboard(ctx, await getAdminPanelText(ctx.from.username), keyboards.adminPanelKeyboard());
});

bot.hears('🟢 Активные аукционы', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const active = await Auction.find({ status: 'active' }).sort({ createdAt: -1 }).limit(20);
  if (!active.length) return replyWithKeyboard(ctx, 'Нет активных.', keyboards.adminPanelKeyboard());
  let msg = '🟢 *Активные:*\n\n';
  for (const a of active) msg += `🆔 #${a._id.toString().slice(-6)}\n📦 ${a.data.name || a.data.species || 'Аукцион'}\n💰 ${a.currentBidDisplay || a.currentBid || 0}\n📅 ${moment(a.endDate).format('DD.MM.YYYY HH:mm')}\n\n`;
  await replyWithKeyboard(ctx, msg, { parse_mode: 'Markdown', ...keyboards.adminPanelKeyboard() });
});

bot.hears('🚫 Заблокированные', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const banned = await User.find({ isAuctionBanned: true });
  if (!banned.length) return replyWithKeyboard(ctx, 'Нет заблокированных.', keyboards.adminPanelKeyboard());
  for (const u of banned) {
    const prev = lastBotMsgId.get(ctx.from.id); if (prev) try { await ctx.telegram.deleteMessage(ctx.chat.id, prev); } catch(e){}
    const msg = await ctx.reply(`🚫 *Заблокирован:*\n\n👤 @${u.username || 'нет'} | ${u.telegramId}\n📝 Причина: ${u.auctionBanReason || 'Не указана'}\n⏰ До: ${u.auctionBanUntil ? moment(u.auctionBanUntil).format('DD.MM.YYYY HH:mm') : 'Навсегда'}`, { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback(`♻️ Разблокировать`, `unban_${u.telegramId}`)]]) });
    lastBotMsgId.set(ctx.from.id, msg.message_id);
  }
});

bot.action(/^unban_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Отказано');
  const uid = parseInt(ctx.match[1]);
  const u = await User.findOne({ telegramId: uid });
  if (!u || !u.isAuctionBanned) return ctx.answerCbQuery('Не заблокирован');
  await User.updateOne({ telegramId: uid }, { isAuctionBanned: false, auctionBanReason: null, auctionBanUntil: null });
  await ModerationLog.create({ targetUserId: uid, adminId: ctx.from.id, action: 'unban' });
  try { await ctx.telegram.sendMessage(uid, '✅ Ограничения сняты.'); } catch (e) {}
  const newText = ctx.callbackQuery.message.text.replace(/🚫 \*Заблокированные\*/, '✅ *Разблокирован*').replace(/♻️ Разблокировать.*/, '✅ *Разблокирован*');
  await ctx.editMessageText(newText, { parse_mode: 'Markdown' });
  await ctx.answerCbQuery('Разблокирован');
});

bot.hears('📋 Логи модерации', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const logs = await ModerationLog.find().sort({ createdAt: -1 }).limit(20);
  if (!logs.length) return replyWithKeyboard(ctx, 'Нет логов.', keyboards.adminPanelKeyboard());
  let msg = '📋 *Последние действия:*\n\n';
  for (const l of logs) {
    const admin = await User.findOne({ telegramId: l.adminId });
    msg += `👮 Админ: @${admin?.username || l.adminId}\n🔧 Действие: ${l.action}\n${l.reason ? `📝 Причина: ${l.reason}\n` : ''}📅 ${moment(l.createdAt).format('DD.MM.YYYY HH:mm')}\n\n`;
  }
  await replyWithKeyboard(ctx, msg, { parse_mode: 'Markdown', ...keyboards.adminPanelKeyboard() });
});

bot.hears('👤 Обычное меню', async (ctx) => { if (isAdmin(ctx)) await replyWithKeyboard(ctx, 'Переключено:', keyboards.mainMenuKeyboard(true)); });

bot.hears('🏆 Рейтинг', async (ctx) => {
  const top = await require('../../services/points.service').getTopSellers(10);
  let msg = '🏆 *Топ продавцов:*\n\n';
  top.forEach((u, i) => { msg += `${i+1}. @${u.username || u.telegramId} — ${u.points} баллов (${u.totalSales} продаж)\n`; });
  await replyWithKeyboard(ctx, msg, { parse_mode: 'Markdown' });
});

bot.hears('💰 Баланс', async (ctx) => {
  const bal = await require('../../services/points.service').getBalance(ctx.from.id);
  await replyWithKeyboard(ctx, `💰 Баланс: *${bal}* баллов`, { parse_mode: 'Markdown' });
});

bot.action(/^report_auction_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery(); ctx.session.reportAuctionId = ctx.match[1];
  const prev = lastBotMsgId.get(ctx.from.id); if (prev) try { await ctx.telegram.deleteMessage(ctx.chat.id, prev); } catch(e){}
  const msg = await ctx.reply('📋 *Жалоба*\n\nОпишите причину в одном сообщении:', { parse_mode: 'Markdown', reply_markup: { force_reply: true } });
  lastBotMsgId.set(ctx.from.id, msg.message_id);
});

bot.on('text', async (ctx, next) => {
  const rid = ctx.session?.reportAuctionId; if (!rid) return next();
  delete ctx.session.reportAuctionId;
  const a = await Auction.findById(rid);
  await ctx.telegram.sendMessage(config.ADMIN_CHAT_ID, `🚨 *ЖАЛОБА*\n\n👤 От: @${ctx.from.username || 'нет'} | ${ctx.from.id}\n🆔 #${rid.slice(-6)}\n📝 Причина: ${ctx.message.text}\n\n[🔗](${a?.channelPostUrl || ''})`, { parse_mode: 'Markdown', disable_web_page_preview: true });
  await replyWithKeyboard(ctx, '✅ Жалоба отправлена.');
});

async function handleShowParams(ctx, auctionId) {
  try {
    let a = await Auction.findById(auctionId) || await AuctionDraft.findById(auctionId);
    if (!a) return replyWithKeyboard(ctx, '❌ Не найден');
    const photos = a.data?.paramPhotos || [];
    if (!photos.length) return replyWithKeyboard(ctx, '❌ Нет фото параметров');
    await ctx.reply('📋 *Фото параметров:*', { parse_mode: 'Markdown' });
    await ctx.telegram.sendMediaGroup(ctx.chat.id, photos.map(f => ({ type: 'photo', media: f })));
  } catch (e) { await replyWithKeyboard(ctx, '❌ Ошибка'); }
}

bot.command('reset_all', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Отказано');
  await ctx.reply('⚠️ *ВНИМАНИЕ!*\n\nУдалить все аукционы и черновики?', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([[Markup.button.callback('✅ Да', 'confirm_reset_all')], [Markup.button.callback('❌ Нет', 'cancel_reset')]]) });
});

bot.action('cancel_reset', async (ctx) => { await ctx.answerCbQuery(); await ctx.deleteMessage(); await ctx.reply('❌ Отменено'); });

bot.action('confirm_reset_all', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return;
  try {
    const dA = await Auction.deleteMany({}), dD = await AuctionDraft.deleteMany({});
    await ctx.editMessageText(`✅ *Очищено!*\nАукционов: ${dA.deletedCount}\nЧерновиков: ${dD.deletedCount}`, { parse_mode: 'Markdown' });
  } catch (e) { await ctx.editMessageText('❌ Ошибка'); }
});

bot.command('reset_drafts', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Отказано');
  const r = await AuctionDraft.deleteMany({});
  await ctx.reply(`✅ Удалено черновиков: ${r.deletedCount}`);
});

bot.command('reset_auctions', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Отказано');
  const r = await Auction.deleteMany({});
  await ctx.reply(`✅ Удалено аукционов: ${r.deletedCount}`);
});
