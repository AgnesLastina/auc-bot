const stateManager = require('../../fsm/state.manager');
const auctionService = require('../../services/auction.service');
const auctionKeyboards = require('../keyboards/auction');
const { formatHorseTemplate, formatAccessoryTemplate, formatPotionTemplate } = require('../../utils/helpers');
const User = require('../../db/models/User');
const { deleteMessages } = require('../../utils/telegram-helpers');

async function updateDraftField(ctx, draftId, data, keepState = false) {
  const draft = await auctionService.updateDraft(draftId, data);
  const state = stateManager.getState(ctx);
  const tms = stateManager.getTempMessages(ctx);

  await deleteMessages(ctx, tms);
  stateManager.clearTempMessages(ctx);

  const user = await User.findOne({ telegramId: ctx.from.id });
  const si = user ? { username: user.username, telegramId: user.telegramId } : null;

  let template, keyboard;
  if (draft.category === 'horse') {
    template = formatHorseTemplate(draft.data, si, false);
    keyboard = auctionKeyboards.horseEditKeyboard();
  } else if (draft.category === 'accessory') {
    template = formatAccessoryTemplate(draft.data, si, false);
    keyboard = auctionKeyboards.accessoryEditKeyboard();
  } else {
    template = formatPotionTemplate(draft.data, si, false);
    keyboard = auctionKeyboards.potionEditKeyboard();
  }

  const mainPhotoChanged = data.hasOwnProperty('mainPhoto');
  const paramPhotosChanged = data.hasOwnProperty('paramPhotos');

  if (mainPhotoChanged || paramPhotosChanged) {
    if (state.templateMessageId) {
      ctx.telegram.deleteMessage(ctx.chat.id, state.templateMessageId).catch(() => {});
    }

    const mainPhoto = draft.data.mainPhoto;
    let nid;

    if (mainPhoto) {
      const msg = await ctx.telegram.sendPhoto(ctx.chat.id, mainPhoto, {
        caption: template, parse_mode: 'HTML', reply_markup: keyboard.reply_markup
      });
      nid = msg.message_id;
    } else {
      const msg = await ctx.telegram.sendMessage(ctx.chat.id, template, {
        parse_mode: 'HTML', reply_markup: keyboard.reply_markup
      });
      nid = msg.message_id;
    }
    stateManager.updateState(ctx, { templateMessageId: nid });
  } else {
    if (state.templateMessageId) {
      try {
        if (draft.data.mainPhoto) {
          ctx.telegram.deleteMessage(ctx.chat.id, state.templateMessageId).catch(() => {});
          const msg = await ctx.telegram.sendPhoto(ctx.chat.id, draft.data.mainPhoto, {
            caption: template, parse_mode: 'HTML', reply_markup: keyboard.reply_markup
          });
          stateManager.updateState(ctx, { templateMessageId: msg.message_id });
        } else {
          await ctx.telegram.editMessageText(ctx.chat.id, state.templateMessageId, null, template, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
        }
      } catch (e) {
        if (!e.message?.includes('not modified')) {
          const msg = await ctx.telegram.sendMessage(ctx.chat.id, template, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup });
          stateManager.updateState(ctx, { templateMessageId: msg.message_id });
        }
      }
    }
  }
  if (!keepState) stateManager.clearAwaitingInput(ctx);
}
module.exports = { updateDraftField };
