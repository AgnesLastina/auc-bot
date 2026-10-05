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

// ============ СПИСОК ШАБЛОНОВ ============
async function showTemplatesList(ctx, userId) {
  const templates = await templateService.listUserTemplates(userId);

  if (templates.length === 0) {
    const msg = await ctx.reply(
      '📁 У вас нет сохранённых шаблонов.\n\n' +
      'Шаблон можно сохранить при создании аукциона — кнопка «💾 Сохранить шаблон» внизу анкеты.',
      Markup.inlineKeyboard([
        [Markup.button.callback('◀️ Назад', 'templates_back')]
      ])
    );
    stateManager.addTempMessage(ctx, msg.message_id);
    return;
  }

  let message = '📁 *Ваши шаблоны:*\n\n';
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    const cat = t.category === 'horse' ? '🐴' : t.category === 'accessory' ? '💍' : '🧪';
    const verified = t.isVerified ? '✅' : '⏳';
    const date = moment(t.createdAt).format('DD.MM.YYYY');
    const used = t.usageCount > 0 ? ` | исп. ${t.usageCount} раз` : '';

    message += `${i + 1}. ${cat} *${t.name}*\n`;
    message += `   ${verified} | ${date}${used}\n`;
    message += `   ID: #${t._id.toString().slice(-6)}\n\n`;
  }

  const buttons = [];
  for (const t of templates) {
    const shortId = t._id.toString().slice(-6);
    buttons.push([
      Markup.button.callback(`▶️ #${shortId}`, `template_use_${t._id}`),
      Markup.button.callback(`✏️ #${shortId}`, `template_rename_${t._id}`),
      Markup.button.callback(`🗑 #${shortId}`, `template_delete_${t._id}`)
    ]);
  }
  buttons.push([Markup.button.callback('◀️ Назад', 'templates_back')]);

  const msg = await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
  stateManager.addTempMessage(ctx, msg.message_id);
}

// ============ CALLBACKS ============
bot.action('show_templates', async (ctx) => {
  await ctx.answerCbQuery();
  await showTemplatesList(ctx, ctx.from.id);
});

bot.action('templates_back', async (ctx) => {
  await ctx.answerCbQuery();
  try { await ctx.deleteMessage(); } catch (e) {}
  const isAdmin = config.ADMIN_IDS.includes(ctx.from.id);
  await ctx.reply('📋 Главное меню', keyboards.mainMenuKeyboard(isAdmin));
});

// ============ ИСПОЛЬЗОВАТЬ ШАБЛОН ============
bot.action(/^template_use_(.+)$/, async (ctx) => {
  const templateId = ctx.match[1];
  await ctx.answerCbQuery();

  const template = await templateService.getTemplate(templateId, ctx.from.id);
  if (!template) {
    await ctx.reply('❌ Шаблон не найден');
    return;
  }

  const tms = stateManager.getTempMessages(ctx);
  await deleteMessages(ctx, tms);
  stateManager.clearTempMessages(ctx);
  try { await ctx.deleteMessage(); } catch (e) {}

  // Создаём новый черновик из шаблона
  const draft = await auctionService.createDraft(ctx.from.id, template.category);
  await auctionService.updateDraft(draft._id, {
    ...template.data,
    mainPhoto: template.data.mainPhoto || null,
    paramPhotos: template.data.paramPhotos || []
  });

  await templateService.touchTemplate(template._id, ctx.from.id);

  stateManager.createAuctionState(ctx, template.category);
  stateManager.updateState(ctx, {
    draftId: draft._id,
    category: template.category,
    manualMode: true,
    templateId: template._id
  });

  const { showAuctionTemplate } = require('./callback');
  const freshDraft = await AuctionDraft.findById(draft._id);
  await showAuctionTemplate(ctx, freshDraft.category, freshDraft, ctx.from.id);

  const verified = template.isVerified
    ? '✅ Шаблон верифицирован — при публикации без изменений пройдёт автоматически.'
    : '⏳ Шаблон ещё не проверялся модерацией — при первой публикации пойдёт на проверку.';

  const msg = await ctx.reply(
    `📋 *Шаблон загружен.*\n\n${verified}\n\nПроверьте данные и нажмите «Опубликовать».`,
    { parse_mode: 'Markdown' }
  );
  stateManager.addTempMessage(ctx, msg.message_id);
});

// ============ ПЕРЕИМЕНОВАТЬ ============
bot.action(/^template_rename_(.+)$/, async (ctx) => {
  const templateId = ctx.match[1];
  await ctx.answerCbQuery();

  const template = await templateService.getTemplate(templateId, ctx.from.id);
  if (!template) { await ctx.reply('❌ Шаблон не найден'); return; }

  ctx.session.awaitingTemplateRename = templateId;

  const msg = await ctx.reply(
    `✏️ Введите новое имя для шаблона «${template.name}»:`,
    Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'template_rename_cancel')]])
  );
  stateManager.addTempMessage(ctx, msg.message_id);
});

bot.action('template_rename_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.awaitingTemplateRename = null;
  try { await ctx.deleteMessage(); } catch (e) {}
});

bot.on('text', async (ctx, next) => {
  const templateId = ctx.session?.awaitingTemplateRename;
  if (!templateId) return next();

  const text = ctx.message.text;
  if (!text || text.startsWith('/')) return next();

  delete ctx.session.awaitingTemplateRename;
  try { await ctx.deleteMessage(); } catch (e) {}

  const template = await templateService.getTemplate(templateId, ctx.from.id);
  if (!template) { await ctx.reply('❌ Шаблон не найден'); return; }

  template.name = text.slice(0, 100);
  template.updatedAt = new Date();
  await template.save();

  await ctx.reply(`✅ Шаблон переименован в «${template.name}»`);
  await showTemplatesList(ctx, ctx.from.id);
});

// ============ УДАЛИТЬ ============
bot.action(/^template_delete_(.+)$/, async (ctx) => {
  const templateId = ctx.match[1];
  await ctx.answerCbQuery();

  const template = await templateService.getTemplate(templateId, ctx.from.id);
  if (!template) { await ctx.reply('❌ Шаблон не найден'); return; }

  const msg = await ctx.reply(
    `🗑 Удалить шаблон «${template.name}»?`,
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Да, удалить', `template_delete_confirm_${templateId}`)],
      [Markup.button.callback('❌ Нет', 'show_templates')]
    ])
  );
  stateManager.addTempMessage(ctx, msg.message_id);
});

bot.action(/^template_delete_confirm_(.+)$/, async (ctx) => {
  const templateId = ctx.match[1];
  await ctx.answerCbQuery('Удалено');

  const ok = await templateService.deleteTemplate(templateId, ctx.from.id);
  try { await ctx.deleteMessage(); } catch (e) {}

  if (ok) await showTemplatesList(ctx, ctx.from.id);
  else await ctx.reply('❌ Не удалось удалить шаблон');
});

module.exports = { showTemplatesList };