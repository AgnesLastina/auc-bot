const bot = require('../bot');
const AuctionDraft = require('../../db/models/AuctionDraft');
const auctionService = require('../../services/auction.service');
const config = require('../../config');
const User = require('../../db/models/User');
const { Markup } = require('telegraf');

console.log('admin.js loaded!');

// Одобрить аукцион
bot.action(/^admin_approve_(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];

  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    await ctx.answerCbQuery('❌ Нет доступа', { show_alert: true });
    return;
  }

  try {
    const draft = await AuctionDraft.findById(draftId);
    if (!draft) {
      await ctx.answerCbQuery('❌ Черновик не найден', { show_alert: true });
      return;
    }

    const auction = await auctionService.approveAuction(draftId, ctx.from.id);

    // ✅ Помечаем шаблон как верифицированный
    try {
      const templateService = require('../../services/template.service');
      const marked = await templateService.markAsVerified(
        draft.userId,
        draft.category,
        draft.data
      );
      if (marked) {
        console.log(`✅ Шаблон для ${draft.userId} помечен как верифицированный`);
      }
    } catch (e) {
      console.error('Failed to mark template as verified:', e.message);
    }

    if (draft.adminKeyboardMsgId) {
      try {
        await ctx.telegram.editMessageText(
          config.ADMIN_CHAT_ID,
          draft.adminKeyboardMsgId,
          null,
          'Действия модерации:\n\n✅ *ОДОБРЕН И ОПУБЛИКОВАН*',
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        console.log('Could not edit admin keyboard message:', e.message);
        await ctx.telegram.sendMessage(
          config.ADMIN_CHAT_ID,
          'Действия модерации:\n\n✅ *ОДОБРЕН И ОПУБЛИКОВАН*',
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      try {
        await ctx.editMessageText(
          'Действия модерации:\n\n✅ *ОДОБРЕН И ОПУБЛИКОВАН*',
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        console.log('Could not edit message');
      }
    }

    // Уведомляем продавца с кнопкой-ссылкой на аукцион
    try {
      const user = await User.findOne({ telegramId: draft.userId });
      if (user) {
        const auctionLink = auction?.channelPostUrl || '';
        const buttons = [];
        if (auctionLink) {
          buttons.push([Markup.button.url('🔗 Перейти к аукциону', auctionLink)]);
        }
        const keyboard = buttons.length > 0 ? Markup.inlineKeyboard(buttons) : null;

        await bot.telegram.sendMessage(
          user.telegramId,
          '✅ Ваш аукцион одобрен и опубликован на канале!',
          keyboard ? { reply_markup: keyboard.reply_markup } : {}
        );
      }
    } catch (e) {
      console.log('Could not notify seller:', e.message);
    }

    await ctx.answerCbQuery('✅ Аукцион одобрен');
  } catch (error) {
    console.error('Approve error:', error);
    await ctx.answerCbQuery('❌ Ошибка: ' + error.message, { show_alert: true });
  }
});

// Отклонить аукцион
bot.action(/^admin_reject_(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];

  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    await ctx.answerCbQuery('❌ Нет доступа', { show_alert: true });
    return;
  }

  try {
    const draft = await AuctionDraft.findById(draftId);
    if (!draft) {
      await ctx.answerCbQuery('❌ Черновик не найден', { show_alert: true });
      return;
    }

    await auctionService.rejectAuction(draftId);

    if (draft.adminKeyboardMsgId) {
      try {
        await ctx.telegram.editMessageText(
          config.ADMIN_CHAT_ID,
          draft.adminKeyboardMsgId,
          null,
          'Действия модерации:\n\n❌ *ОТКЛОНЕН*',
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        await ctx.telegram.sendMessage(
          config.ADMIN_CHAT_ID,
          'Действия модерации:\n\n❌ *ОТКЛОНЕН*',
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      try {
        await ctx.editMessageText(
          'Действия модерации:\n\n❌ *ОТКЛОНЕН*',
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        console.log('Could not edit message');
      }
    }

    try {
      const user = await User.findOne({ telegramId: draft.userId });
      if (user) {
        await bot.telegram.sendMessage(
          user.telegramId,
          '❌ Ваш аукцион отклонен модератором.'
        );
      }
    } catch (e) {}

    await ctx.answerCbQuery('❌ Аукцион отклонен');
  } catch (error) {
    console.error('Reject error:', error);
    await ctx.answerCbQuery('❌ Ошибка', { show_alert: true });
  }
});

// На доработку
bot.action(/^admin_revision_(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];

  if (!config.ADMIN_IDS.includes(ctx.from.id)) {
    await ctx.answerCbQuery('❌ Нет доступа', { show_alert: true });
    return;
  }

  try {
    const draft = await AuctionDraft.findById(draftId);
    if (!draft) {
      await ctx.answerCbQuery('❌ Черновик не найден', { show_alert: true });
      return;
    }

    await auctionService.sendForRevision(draftId);

    if (draft.adminKeyboardMsgId) {
      try {
        await ctx.telegram.editMessageText(
          config.ADMIN_CHAT_ID,
          draft.adminKeyboardMsgId,
          null,
          'Действия модерации:\n\n✏️ *ОТПРАВЛЕН НА ДОРАБОТКУ*',
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        await ctx.telegram.sendMessage(
          config.ADMIN_CHAT_ID,
          'Действия модерации:\n\n✏️ *ОТПРАВЛЕН НА ДОРАБОТКУ*',
          { parse_mode: 'Markdown' }
        );
      }
    } else {
      try {
        await ctx.editMessageText(
          'Действия модерации:\n\n✏️ *ОТПРАВЛЕН НА ДОРАБОТКУ*',
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        console.log('Could not edit message');
      }
    }

    // Уведомляем продавца с кнопкой «Исправить»
    try {
      const user = await User.findOne({ telegramId: draft.userId });
      if (user) {
        await bot.telegram.sendMessage(
          user.telegramId,
          '✏️ Ваш аукцион отправлен на доработку модератором.',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✏️ Исправить', `fix_draft_${draft._id}`)]
            ])
          }
        );
      }
    } catch (e) {
      console.log('Could not notify seller about revision:', e.message);
    }

    await ctx.answerCbQuery('✏️ На доработку');
  } catch (error) {
    console.error('Revision error:', error);
    await ctx.answerCbQuery('❌ Ошибка: ' + error.message, { show_alert: true });
  }
});

module.exports = {};