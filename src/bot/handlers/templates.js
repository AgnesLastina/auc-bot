const bot = require('../bot');
const AuctionDraft = require('../../db/models/AuctionDraft');
const templateService = require('../../services/template.service');
const auctionService = require('../../services/auction.service');
const stateManager = require('../../fsm/state.manager');
const keyboards = require('../keyboards/main');
const config = require('../../config');
const { Markup } = require('telegraf');
const moment = require('moment');
const { deleteMessages } = require('../../utils/telegram-helpers');

async function showTemplatesList(ctx, userId) {
  const templates = await templateService.listUserTemplates(userId);
  if (templates.length === 0) {
    const msg = await ctx.reply('📁 У вас нет сохранённых шаблонов.\n\nШаблон можно сохранить при создании аукциона.', Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад', 'templates_back')]]));
    stateManager.addTempMessage(ctx, msg.message_id);
    return;
  }
  let message = '📁 *Ваши шаблоны:*\n\n';
  templates.forEach((t, i) => {
    const cat = t.category === 'horse' ? '🐴' : t.category === 'accessory' ? '💍' : '🧪';
    message += `${i + 1}. ${cat} *${t.name}*\n   ${t.isVerified ? '✅' : '⏳'} | ${moment(t.createdAt).format('DD.MM.YYYY')}${t.usageCount > 0 ? ` | исп. ${t.usageCount} раз` : ''}\n   ID: #${t._id.toString().slice(-6)}\n\n`;
  });
  const buttons = templates.map(t => {
    const shortId = t._id.toString().slice(-6);
    return [Markup.button.callback(`▶️ #${shortId}`, `template_use_${t._id}`), Markup.button.callback(`✏️ #${shortId}`, `template_rename_${t._id}`), Markup.button.callback(`🗑 #${shortId}`, `template_delete_${t._id}`)];
  });
  buttons.push([Markup.button.callback('◀️ Назад', 'templates_back')]);
  const msg = await ctx.reply(message, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  stateManager.addTempMessage(ctx, msg.message_id);
}

bot.action('show_templates', async (ctx) => { await ctx.answerCbQuery(); await showTemplatesList(ctx, ctx.from.id); });
bot.action('templates_back', async (ctx) => { await ctx.answerCbQuery(); try { await ctx.deleteMessage(); } catch (e) {} await ctx.reply('📋 Главное меню', keyboards.mainMenuKeyboard(config.ADMIN_IDS.includes(ctx.from.id))); });

bot.action(/^template_use_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const template = await templateService.getTemplate(ctx.match[1], ctx.from.id);
  if (!template) return ctx.reply('❌ Шаблон не найден');
  await deleteMessages(ctx, stateManager.getTempMessages(ctx)); stateManager.clearTempMessages(ctx);
  try { await ctx.deleteMessage(); } catch (e) {}
  const draft = await auctionService.createDraft(ctx.from.id, template.category);
  await auctionService.updateDraft(draft._id, { ...template.data, mainPhoto: template.data.mainPhoto || null, paramPhotos: template.data.paramPhotos || [] });
  await templateService.touchTemplate(template._id, ctx.from.id);
  stateManager.createAuctionState(ctx, template.category);
  stateManager.updateState(ctx, { draftId: draft._id, category: template.category, manualMode: true, templateId: template._id });
  const { showAuctionTemplate } = require('./callback');
  const freshDraft = await AuctionDraft.findById(draft._id);
  await showAuctionTemplate(ctx, freshDraft.category, freshDraft, ctx.from.id);
});

bot.action(/^template_rename_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const template = await templateService.getTemplate(ctx.match[1], ctx.from.id);
  if (!template) return ctx.reply('❌ Шаблон не найден');
  ctx.session.awaitingTemplateRename = ctx.match[1];
  const msg = await ctx.reply(`✏️ Введите новое имя для шаблона «${template.name}»:`, Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'template_rename_cancel')]]));
  stateManager.addTempMessage(ctx, msg.message_id);
});

bot.action('template_rename_cancel', async (ctx) => { await ctx.answerCbQuery(); ctx.session.awaitingTemplateRename = null; try { await ctx.deleteMessage(); } catch (e) {} });

bot.on('text', async (ctx, next) => {
  const id = ctx.session?.awaitingTemplateRename; if (!id) return next();
  const text = ctx.message.text; if (!text || text.startsWith('/')) return next();
  delete ctx.session.awaitingTemplateRename; try { await ctx.deleteMessage(); } catch (e) {}
  const t = await templateService.getTemplate(id, ctx.from.id); if (!t) return ctx.reply('❌ Шаблон не найден');
  t.name = text.slice(0, 100); t.updatedAt = new Date(); await t.save();
  await ctx.reply(`✅ Шаблон переименован в «${t.name}»`);
  await showTemplatesList(ctx, ctx.from.id);
});

bot.action(/^template_delete_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const t = await templateService.getTemplate(ctx.match[1], ctx.from.id);
  if (!t) return ctx.reply('❌ Шаблон не найден');
  const msg = await ctx.reply(`🗑 Удалить шаблон «${t.name}»?`, Markup.inlineKeyboard([[Markup.button.callback('✅ Да', `template_delete_confirm_${ctx.match[1]}`)], [Markup.button.callback('❌ Нет', 'show_templates')]]));
  stateManager.addTempMessage(ctx, msg.message_id);
});

bot.action(/^template_delete_confirm_(.+)$/, async (ctx) => { await ctx.answerCbQuery('Удалено'); await templateService.deleteTemplate(ctx.match[1], ctx.from.id); try { await ctx.deleteMessage(); } catch (e) {} await showTemplatesList(ctx, ctx.from.id); });
module.exports = { showTemplatesList };
