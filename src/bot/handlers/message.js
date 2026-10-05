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

  if (!state || !state.awaitingInput) {
    return next();
  }

  const { type, field, validator } = state.awaitingInput;

  // ==================== ФОТО ====================
  if (ctx.message?.photo) {
    // ✅ OCR-типы — обрабатываем МАССИВ фото за раз
    if (type === 'ocrData') {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const draftId = state.draftId;
      const mediaGroupId = ctx.message.media_group_id;
      const category = state.category || 'horse';

      try { await ctx.deleteMessage(); } catch (e) {}

      // Если это media_group — копим фото и обрабатываем через 3 секунды
      if (mediaGroupId) {
        let groupData = ocrMediaGroupCache.get(mediaGroupId);
        if (!groupData) {
          groupData = {
            photos: [],
            userId: ctx.from.id,
            chatId: ctx.chat.id,
            draftId,
            category,
            timer: null
          };
          ocrMediaGroupCache.set(mediaGroupId, groupData);
        }
        if (!groupData.photos.includes(photo.file_id)) {
          groupData.photos.push(photo.file_id);
        }
        if (groupData.timer) clearTimeout(groupData.timer);

        groupData.timer = setTimeout(async () => {
          await processOcrBatch(ctx, groupData);
          ocrMediaGroupCache.delete(mediaGroupId);
        }, 3000);

        return;
      }

      // Одиночное фото — обрабатываем сразу
      await processOcrBatch(ctx, {
        photos: [photo.file_id],
        userId: ctx.from.id,
        chatId: ctx.chat.id,
        draftId,
        category
      });
      return;
    }

    // ✅ Обычные фото (mainPhoto / paramPhotos)
    if (type !== 'mainPhoto' && type !== 'paramPhotos') {
      return next();
    }

    const mediaGroupId = ctx.message.media_group_id;
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    const draftId = state.draftId;

    try { await ctx.deleteMessage(); } catch (e) {}

    if (type === 'mainPhoto') {
      try {
        const draft = await AuctionDraft.findById(draftId);
        if (!draft) {
          const msg = await ctx.reply('❌ Черновик не найден');
          stateManager.addTempMessage(ctx, msg.message_id);
          return;
        }

        await auctionService.updateDraft(draft._id, { mainPhoto: photo.file_id });
        await updateDraftField(ctx, draftId, { mainPhoto: photo.file_id });

        const currentState = stateManager.getState(ctx);
        const tms = currentState.tempMessages || [];
        for (const id of tms) {
          try { await ctx.telegram.deleteMessage(ctx.chat.id, id); } catch (e) {}
        }
        stateManager.clearTempMessages(ctx);

        const { showPhotoMenu } = require('./photo.handler');
        const freshDraft = await AuctionDraft.findById(draftId);
        await showPhotoMenu(ctx, freshDraft);

      } catch (error) {
        console.error('Main photo error:', error);
        const msg = await ctx.reply('❌ Ошибка при добавлении фото');
        stateManager.addTempMessage(ctx, msg.message_id);
      }
      return;
    }

    if (type === 'paramPhotos' && !mediaGroupId) {
      try {
        const draft = await AuctionDraft.findById(draftId);
        if (!draft) {
          const msg = await ctx.reply('❌ Черновик не найден');
          stateManager.addTempMessage(ctx, msg.message_id);
          return;
        }

        const paramPhotos = draft.data.paramPhotos || [];

        if (paramPhotos.length >= 10) {
          const msg = await ctx.reply('❌ Максимальное количество фото параметров - 10');
          stateManager.addTempMessage(ctx, msg.message_id);
          return;
        }

        if (!paramPhotos.includes(photo.file_id)) {
          paramPhotos.push(photo.file_id);
          await auctionService.updateDraft(draft._id, { paramPhotos });
        }

        const msg = await ctx.reply(`✅ Фото параметров добавлено! (${paramPhotos.length}/10)\nОтправьте ещё или нажмите "Назад"`);
        stateManager.addTempMessage(ctx, msg.message_id);

        await updateDraftField(ctx, draftId, { paramPhotos }, true);

      } catch (error) {
        console.error('Param photo error:', error);
        const msg = await ctx.reply('❌ Ошибка при добавлении фото');
        stateManager.addTempMessage(ctx, msg.message_id);
      }
      return;
    }

    if (type === 'paramPhotos' && mediaGroupId) {
      let groupData = mediaGroupCache.get(mediaGroupId);
      if (!groupData) {
        groupData = { photos: [], userId, chatId, draftId, timer: null };
        mediaGroupCache.set(mediaGroupId, groupData);
      }

      if (!groupData.photos.includes(photo.file_id)) {
        groupData.photos.push(photo.file_id);
      }

      if (groupData.timer) clearTimeout(groupData.timer);

      groupData.timer = setTimeout(async () => {
        try {
          const draft = await AuctionDraft.findById(groupData.draftId);
          if (!draft) {
            mediaGroupCache.delete(mediaGroupId);
            return;
          }

          let existingPhotos = draft.data.paramPhotos || [];

          for (const fileId of groupData.photos) {
            if (existingPhotos.length >= 10) break;
            if (!existingPhotos.includes(fileId)) existingPhotos.push(fileId);
          }

          await auctionService.updateDraft(groupData.draftId, { paramPhotos: existingPhotos });

          await bot.telegram.sendMessage(
            groupData.chatId,
            `✅ Добавлено фото параметров: ${existingPhotos.length}/10\nОтправьте ещё или нажмите "Назад"`
          );

          const currentState = stateManager.getStateByUserId(groupData.userId);
          if (currentState && currentState.awaitingInput?.type === 'paramPhotos') {
            const fakeCtx = {
              from: { id: groupData.userId },
              chat: { id: groupData.chatId },
              telegram: bot.telegram,
              reply: async (text, extra) => bot.telegram.sendMessage(groupData.chatId, text, extra)
            };
            await updateDraftField(fakeCtx, groupData.draftId, { paramPhotos: existingPhotos }, true);
          }

        } catch (error) {
          console.error('Media group error:', error);
          await bot.telegram.sendMessage(groupData.chatId, '❌ Ошибка при обработке фото');
        } finally {
          mediaGroupCache.delete(mediaGroupId);
        }
      }, 3000);

      return;
    }
  }

  // ==================== ТЕКСТ ====================
  if (ctx.message?.text && type === 'text') {
    try { await ctx.deleteMessage(); } catch (e) {}

    if (validator === 'mutationSlots') {
      if (!validators.validateMutationSlots(ctx.message.text)) {
        const msg = await ctx.reply('❌ Введите корректное значение: "1/3", "2/3", "3/3"!');
        stateManager.addTempMessage(ctx, msg.message_id);
        return;
      }
      await updateDraftField(ctx, state.draftId, { mutationSlots: ctx.message.text });
    }
    else if (validator === 'price') {
      if (!validators.validatePrice(ctx.message.text)) {
        const msg = await ctx.reply('❌ Введите корректную цену!');
        stateManager.addTempMessage(ctx, msg.message_id);
        return;
      }
      if (field === 'autoBuyoutPrice') {
        await updateDraftField(ctx, state.draftId, { autoBuyout: 'да', autoBuyoutPrice: ctx.message.text });
      } else {
        await updateDraftField(ctx, state.draftId, { [field]: ctx.message.text });
      }
    }
    else if (validator === 'quantity') {
      if (!validators.validateQuantity(ctx.message.text)) {
        const msg = await ctx.reply('❌ Введите корректное значение! (1-999)');
        stateManager.addTempMessage(ctx, msg.message_id);
        return;
      }
      await updateDraftField(ctx, state.draftId, { [field]: parseInt(ctx.message.text) });
    }
    else if (validator === 'reserveDays') {
      if (!validators.validateReserveDays(ctx.message.text)) {
        const msg = await ctx.reply('❌ Введите корректное количество дней брони! (1-365)');
        stateManager.addTempMessage(ctx, msg.message_id);
        return;
      }
      await updateDraftField(ctx, state.draftId, { reserve: 'да', reserveDays: parseInt(ctx.message.text) });
    }
    else if (validator === 'endDate') {
      if (!validators.validateEndDate(ctx.message.text)) {
        const msg = await ctx.reply('❌ Неверный формат даты! ДД.ММ.ГГГГ ЧЧ:ММ');
        stateManager.addTempMessage(ctx, msg.message_id);
        return;
      }
      const [datePart, timePart] = ctx.message.text.split(' ');
      const [day, month, year] = datePart.split('.');
      const [hour, minute] = timePart.split(':');
      const endDate = moment(`${year}-${month}-${day} ${hour}:${minute}`, 'YYYY-MM-DD HH:mm').utcOffset(3, true).toDate();
      await updateDraftField(ctx, state.draftId, { endDate, endDateFormatted: ctx.message.text });
    }
    else {
      await updateDraftField(ctx, state.draftId, { [field]: ctx.message.text });
    }
    return;
  }

  return next();
});

// ============ ОБРАБОТКА OCR ПАЧКИ ФОТО ============
async function processOcrBatch(ctx, groupData) {
  const { photos, draftId, category } = groupData;

  if (!extractAllData) {
    await bot.telegram.sendMessage(
      groupData.chatId,
      '❌ Функция распознавания временно недоступна. Заполните вручную.'
    );
    return;
  }

  const loadingMsg = await bot.telegram.sendMessage(
    groupData.chatId,
    `🔍 Распознаю ${photos.length} фото... Не нажимайте ничего до завершения процесса (5–15 секунд)`
  );

  try {
    const imageBuffers = await downloadImages(bot.telegram, photos);
    const parsedData = await extractAllData(imageBuffers, category);

    // Определяем чего не хватает
    const missingFields = [];
    if (category === 'horse') {
      if (!parsedData.species) missingFields.push('SPECIES');
      if (!parsedData.gender) missingFields.push('GENDER');
      if (!parsedData.size) missingFields.push('SIZE');
    } else if (category === 'accessory') {
      if (!parsedData.name) missingFields.push('NAME');
      if (!parsedData.accessoryType) missingFields.push('TYPE');
    } else {
      if (!parsedData.name) missingFields.push('NAME');
    }

    try { await bot.telegram.deleteMessage(groupData.chatId, loadingMsg.message_id); } catch (e) {}

    // Формируем "fake ctx" для showOcrPreview
    const fakeCtx = {
      from: { id: groupData.userId },
      chat: { id: groupData.chatId },
      telegram: bot.telegram,
      reply: async (text, extra) => bot.telegram.sendMessage(groupData.chatId, text, extra),
      answerCbQuery: async () => {},
      deleteMessage: async () => {}
    };

    await showOcrPreview(fakeCtx, draftId, parsedData, missingFields, category);

    // Сбрасываем awaitingInput у пользователя
    const sessionState = stateManager.getStateByUserId(groupData.userId);
    if (sessionState) {
      sessionState.awaitingInput = null;
    }

  } catch (ocrError) {
    console.error('OCR batch error:', ocrError);
    try { await bot.telegram.deleteMessage(groupData.chatId, loadingMsg.message_id); } catch (e) {}

    await bot.telegram.sendMessage(
      groupData.chatId,
      '❌ Не удалось распознать параметры с этих фото.\n\n' +
      'Вы можете:\n' +
      '• Отправить другие фото\n' +
      '• Заполнить шаблон вручную — данные будут проверены модерацией',
      Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Заполнить вручную', `manual_fill_${draftId}`)],
        [Markup.button.callback('🔄 Попробовать другие фото', 'retry_ocr')],
        [Markup.button.callback('❌ Отменить', 'action_cancel')]
      ])
    );

    const sessionState = stateManager.getStateByUserId(groupData.userId);
    if (sessionState) {
      sessionState.awaitingInput = null;
    }
  }
}

module.exports = {};