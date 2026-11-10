const bot = require('../bot');
const AuctionDraft = require('../../db/models/AuctionDraft');
const stateManager = require('../../fsm/state.manager');
const keyboards = require('../keyboards/main');
const config = require('../../config');
const { Markup } = require('telegraf');
const moment = require('moment');
const { deleteMessages } = require('../../utils/telegram-helpers');

async function showDraftsList(ctx, userId) {
  const drafts = await AuctionDraft.find({ userId, status: { $in: ['draft', 'needs_revision'] } }).sort({ createdAt: -1 }).limit(20);

  if (drafts.length === 0) {
    const msg = await ctx.reply('📂 У вас нет сохранённых черновиков.\n\nВыберите категорию нового аукциона:', keyboards.categoryKeyboard());
    stateManager.addTempMessage(ctx, msg.message_id);
    return;
  }

  let message = '📂 *Ваши черновики:*\n\n';
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const cat = d.category === 'horse' ? '🐴 Лошадь' : d.category === 'accessory' ? '💍 Аксессуар' : '🧪 Зелье';
    const name = d.data.name || d.data.species || 'Без названия';
    const status = d.status === 'needs_revision' ? '✏️ требует доработки' : '📝 черновик';
    const date = moment(d.createdAt).format('DD.MM.YYYY HH:mm');
    message += `${i + 1}. ${cat} — *${name}*\n   ${status} | ${date}\n   ID: #${d._id.toString().slice(-6)}\n\n`;
  }

  const buttons = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const shortId = d._id.toString().slice(-6);
    buttons.push([Markup.button.callback(`▶️ #${shortId} продолжить`, `draft_continue_${d._id}`), Markup.button.callback(`🗑 #${shortId}`, `draft_delete_${d._id}`)]);
  }
  buttons.push([Markup.button.callback('🆕 Создать новый', 'draft_new')]);
  buttons.push([Markup.button.callback('❌ Закрыть', 'draft_close')]);

  const msg = await ctx.reply(message, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  stateManager.addTempMessage(ctx, msg.message_id);
}

bot.action('show_drafts', async (ctx) => { await ctx.answerCbQuery(); await showDraftsList(ctx, ctx.from.id); });

bot.action(/^draft_continue_(.+)$/, async (ctx) => {
  const draft = await AuctionDraft.findById(ctx.match[1]);
  await ctx.answerCbQuery();
  if (!draft || draft.userId !== ctx.from.id) return ctx.reply('❌ Черновик не найден');
  const tms = stateManager.getTempMessages(ctx);
  await deleteMessages(ctx, tms);
  stateManager.clearTempMessages(ctx);
  try { await ctx.deleteMessage(); } catch (e) {}
  stateManager.createAuctionState(ctx, draft.category);
  stateManager.updateState(ctx, { draftId: draft._id, category: draft.category, manualMode: draft.data.isManualFill || false });
  const { showAuctionTemplate } = require('./callback');
  await showAuctionTemplate(ctx, draft.category, draft, ctx.from.id);
});

bot.action(/^draft_delete_(.+)$/, async (ctx) => {
  const draft = await AuctionDraft.findById(ctx.match[1]);
  await ctx.answerCbQuery();
  if (!draft || draft.userId !== ctx.from.id) return ctx.reply('❌ Черновик не найден');
  await AuctionDraft.findByIdAndDelete(ctx.match[1]);
  try { await ctx.deleteMessage(); } catch (e) {}
  await showDraftsList(ctx, ctx.from.id);
});

bot.action('draft_new', async (ctx) => {
  await ctx.answerCbQuery(); try { await ctx.deleteMessage(); } catch (e) {}
  const msg = await ctx.reply('Выберите категорию нового аукциона:', keyboards.categoryKeyboard());
  stateManager.addTempMessage(ctx, msg.message_id);
});

bot.action('draft_close', async (ctx) => {
  await ctx.answerCbQuery(); try { await ctx.deleteMessage(); } catch (e) {}
  await ctx.reply('📋 Главное меню', keyboards.mainMenuKeyboard(config.ADMIN_IDS.includes(ctx.from.id)));
});

module.exports = { showDraftsList };
