const bot = require('../bot');
const stateManager = require('../../fsm/state.manager');
const validators = require('../../utils/validators');
const { updateDraftField } = require('./draft.handler');
const auctionService = require('../../services/auction.service');
const AuctionDraft = require('../../db/models/AuctionDraft');
const moment = require('moment');
const { Markup } = require('telegraf');

let extractAllData, downloadImages, showOcrPreview;
try {
  ({ extractAllData, downloadImages } = require('../../services/gemini.service'));
  ({ showOcrPreview } = require('./ocrPreview'));
  console.log('✅ OCR modules loaded');
} catch (e) {
  console.error('❌ OCR modules failed:', e.message);
}

console.log('message.js loaded!');

const mediaGroupCache = new Map();
const ocrMediaGroupCache = new Map();

bot.use(async (ctx, next) => {
  const state = stateManager.getState(ctx);
  if (!state || !state.awaitingInput) return next();
  const { type, field, validator } = state.awaitingInput;

  if (ctx.message?.photo) {
    if (type === 'ocrData') {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const draftId = state.draftId;
      const mediaGroupId = ctx.message.media_group_id;
      const category = state.category || 'horse';
      try { await ctx.deleteMessage(); } catch (e) {}

      if (mediaGroupId) {
        let groupData = ocrMediaGroupCache.get(mediaGroupId);
        if (!groupData) {
          groupData = { photos: [], userId: ctx.from.id, chatId: ctx.chat.id, draftId, category, timer: null };
          ocrMediaGroupCache.set(mediaGroupId, groupData);
        }
        if (!groupData.photos.includes(photo.file_id)) groupData.photos.push(photo.file_id);
        if (groupData.timer) clearTimeout(groupData.timer);
        groupData.timer = setTimeout(async () => { await processOcrBatch(ctx, groupData); ocrMediaGroupCache.delete(mediaGroupId); }, 3000);
        return;
      }
      await processOcrBatch(ctx, { photos: [photo.file_id], userId: ctx.from.id, chatId: ctx.chat.id, draftId, category });
      return;
    }

    if (type !== 'mainPhoto' && type !== 'paramPhotos') return next();

    const mediaGroupId = ctx.message.media_group_id;
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const draftId = state.draftId;
    try { await ctx.deleteMessage(); } catch (e) {}

    if (type === 'mainPhoto') {
      try {
        const draft = await AuctionDraft.findById(draftId);
        if (!draft) { const msg = await ctx.reply('❌ Черновик не найден'); stateManager.addTempMessage(ctx, msg.message_id); return; }
        await auctionService.updateDraft(draft._id, { mainPhoto: photo.file_id });
        await updateDraftField(ctx, draftId, { mainPhoto: photo.file_id });
        const currentState = stateManager.getState(ctx);
        for (const id of (currentState.tempMessages || [])) { try { await ctx.telegram.deleteMessage(ctx.chat.id, id); } catch (e) {} }
        stateManager.clearTempMessages(ctx);
        const { showPhotoMenu } = require('./photo.handler');
        await showPhotoMenu(ctx, await AuctionDraft.findById(draftId));
      } catch (error) {
        const msg = await ctx.reply('❌ Ошибка при добавлении фото');
        stateManager.addTempMessage(ctx, msg.message_id);
      }
      return;
    }

    if (type === 'paramPhotos' && !mediaGroupId) {
      try {
        const draft = await AuctionDraft.findById(draftId);
        if (!draft) { const msg = await ctx.reply('❌ Черновик не найден'); stateManager.addTempMessage(ctx, msg.message_id); return; }
        const paramPhotos = draft.data.paramPhotos || [];
        if (paramPhotos.length >= 10) { const msg = await ctx.reply('❌ Максимальное количество фото параметров - 10'); stateManager.addTempMessage(ctx, msg.message_id); return; }
        if (!paramPhotos.includes(photo.file_id)) { paramPhotos.push(photo.file_id); await auctionService.updateDraft(draft._id, { paramPhotos }); }
        const msg = await ctx.reply(`✅ Фото параметров добавлено! (${paramPhotos.length}/10)\nОтправьте ещё или нажмите "Назад"`);
        stateManager.addTempMessage(ctx, msg.message_id);
        await updateDraftField(ctx, draftId, { paramPhotos }, true);
      } catch (error) {
        const msg = await ctx.reply('❌ Ошибка при добавлении фото');
        stateManager.addTempMessage(ctx, msg.message_id);
      }
      return;
    }

    if (type === 'paramPhotos' && mediaGroupId) {
      let groupData = mediaGroupCache.get(mediaGroupId);
      if (!groupData) { groupData = { photos: [], userId, chatId, draftId, timer: null }; mediaGroupCache.set(mediaGroupId, groupData); }
      if (!groupData.photos.includes(photo.file_id)) groupData.photos.push(photo.file_id);
      if (groupData.timer) clearTimeout(groupData.timer);
      groupData.timer = setTimeout(async () => {
        try {
          const draft = await AuctionDraft.findById(groupData.draftId);
          if (!draft) { mediaGroupCache.delete(mediaGroupId); return; }
          let existingPhotos = draft.data.paramPhotos || [];
          for (const fileId of groupData.photos) { if (existingPhotos.length >= 10) break; if (!existingPhotos.includes(fileId)) existingPhotos.push(fileId); }
          await auctionService.updateDraft(groupData.draftId, { paramPhotos: existingPhotos });
          await bot.telegram.sendMessage(groupData.chatId, `✅ Добавлено фото параметров: ${existingPhotos.length}/10\nОтправьте ещё или нажмите "Назад"`);
          const currentState = stateManager.getStateByUserId(groupData.userId);
          if (currentState && currentState.awaitingInput?.type === 'paramPhotos') {
            const fakeCtx = { from: { id: groupData.userId }, chat: { id: groupData.chatId }, telegram: bot.telegram, reply: async (text, extra) => bot.telegram.sendMessage(groupData.chatId, text, extra) };
            await updateDraftField(fakeCtx, groupData.draftId, { paramPhotos: existingPhotos }, true);
          }
        } catch (error) { await bot.telegram.sendMessage(groupData.chatId, '❌ Ошибка при обработке фото'); } finally { mediaGroupCache.delete(mediaGroupId); }
      }, 3000);
      return;
    }
  }
