const bot = require('../bot');
const auctionService = require('../../services/auction.service');
const settingsService = require('../../services/settings.service');
const templateService = require('../../services/template.service');
const stateManager = require('../../fsm/state.manager');
const keyboards = require('../keyboards/main');
const auctionKeyboards = require('../keyboards/auction');
const {
  formatMissingFields,
  validateRequiredFields,
  formatHorseTemplate,
  formatAccessoryTemplate,
  formatPotionTemplate
} = require('../../utils/helpers');
const constants = require('../../utils/constants');
const { Markup } = require('telegraf');
const AuctionDraft = require('../../db/models/AuctionDraft');
const Auction = require('../../db/models/Auction');
const AuctionTemplate = require('../../db/models/AuctionTemplate');
const User = require('../../db/models/User');
const config = require('../../config');
const moment = require('moment');

const { updateDraftField } = require('./draft.handler');
const { showPhotoMenu } = require('./photo.handler');
const { goToManualEdit } = require('./ocrPreview');
const { deleteAndAnswer, deleteMessages } = require('../../utils/telegram-helpers');

const safeDeleteCurrentMessage = async (ctx) => {
  try { await ctx.deleteMessage(); } catch (e) {}
};

// ============ SHOW PARAMS ============
bot.action(/^show_params_(.+)$/, async (ctx) => {
  const auctionId = ctx.match[1];
  try {
    let auction = await Auction.findById(auctionId);
    if (!auction) auction = await AuctionDraft.findById(auctionId);
    if (!auction) {
      await ctx.answerCbQuery('❌ Аукцион не найден', { show_alert: true });
      return;
    }
    const paramPhotos = auction.data?.paramPhotos || [];
    if (paramPhotos.length === 0) {
      await ctx.answerCbQuery('❌ Продавец не добавил фото параметров', { show_alert: true });
      return;
    }
    const mediaGroup = paramPhotos.map(fileId => ({ type: 'photo', media: fileId }));
    await ctx.answerCbQuery('📋 Параметры отправлены в ЛС', { show_alert: true });
    await ctx.telegram.sendMessage(ctx.from.id, '📋 *Фото параметров лошади:*', { parse_mode: 'Markdown' });
    await ctx.telegram.sendMediaGroup(ctx.from.id, mediaGroup);
  } catch (error) {
    console.error('Error showing params:', error);
    await ctx.answerCbQuery('❌ Ошибка при отправке параметров', { show_alert: true });
  }
});

bot.action(/^admin_check_params_(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];
  try {
    const draft = await AuctionDraft.findById(draftId);
    if (!draft) {
      await ctx.answerCbQuery('❌ Черновик не найден', { show_alert: true });
      return;
    }
    const paramPhotos = draft.data?.paramPhotos || [];
    if (paramPhotos.length === 0) {
      await ctx.answerCbQuery('❌ Продавец не добавил фото параметров', { show_alert: true });
      return;
    }
    const mediaGroup = paramPhotos.map(fileId => ({ type: 'photo', media: fileId }));
    await ctx.answerCbQuery('📋 Параметры показаны');
    await ctx.reply(`📋 *Фото параметров для аукциона #${draftId.toString().slice(-6)}*`, { parse_mode: 'Markdown' });
    await ctx.telegram.sendMediaGroup(ctx.chat.id, mediaGroup);
  } catch (error) {
    console.error('Error showing admin params:', error);
    await ctx.answerCbQuery('❌ Ошибка', { show_alert: true });
  }
});

// ============ CATEGORY ============
bot.action(/^category_(.+)$/, async (ctx) => {
  const category = ctx.match[1];
  const userId = ctx.from.id;
  await ctx.answerCbQuery();

  const user = await User.findOne({ telegramId: userId });
  if (user?.isAuctionBanned) {
    const banUntil = user.auctionBanUntil ? moment(user.auctionBanUntil).format('DD.MM.YYYY HH:mm') : 'навсегда';
    await ctx.reply(`🚫 Вы заблокированы!\n\nПричина: ${user.auctionBanReason || 'Нарушение правил'}\nРазбан: ${banUntil}`);
    return;
  }

  const draft = await auctionService.createDraft(userId, category);
  stateManager.createAuctionState(ctx, category);
  stateManager.updateState(ctx, {
    draftId: draft._id,
    category: category,
    pendingOcrData: null,
    ocrMissingFields: [],
    ocrDraftId: null,
    ocrType: null,
    manualMode: false
  });

  await safeDeleteCurrentMessage(ctx);
  await showFillMethodChoice(ctx, draft._id, category);
});

bot.action(/^continue_draft_(.+)$/, async (ctx) => {
  const draft = await AuctionDraft.findById(ctx.match[1]);
  await ctx.answerCbQuery();
  await safeDeleteCurrentMessage(ctx);
  stateManager.createAuctionState(ctx, draft.category);
  stateManager.updateState(ctx, { draftId: draft._id, category: draft.category, manualMode: false });
  await showAuctionTemplate(ctx, draft.category, draft, ctx.from.id);
});

bot.action(/^delete_draft_(.+)$/, async (ctx) => {
  await auctionService.cancelDraft(ctx.match[1]);
  await ctx.answerCbQuery();
  stateManager.clearState(ctx);
  await ctx.editMessageText('Выберите категорию:', keyboards.categoryKeyboard());
});

// ============ FILL METHOD ============
async function showFillMethodChoice(ctx, draftId, category) {
  const msg = await ctx.reply(
    '📋 *Как заполнить параметры?*\n\n' +
    'Вы можете ввести данные вручную или загрузить скриншоты из игры, и бот заполнит их автоматически.\n\n' +
    '⚠️ *Скриншоты должны быть на английском языке!* Русский интерфейс не обрабатывается.',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✏️ Ввести вручную', `fill_manual_${draftId}`)],
        [Markup.button.callback('📸 Заполнить с фото', `fill_ocr_${draftId}`)],
        [Markup.button.callback('❌ Отменить', 'action_cancel')]
      ])
    }
  );
  stateManager.addTempMessage(ctx, msg.message_id);
}

bot.action(/^fill_manual_(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];
  await ctx.answerCbQuery();
  const draft = await AuctionDraft.findById(draftId);
  if (!draft) { await ctx.reply('❌ Черновик не найден'); return; }
  await safeDeleteCurrentMessage(ctx);
  stateManager.updateState(ctx, { draftId: draft._id, category: draft.category, manualMode: true });
  await showAuctionTemplate(ctx, draft.category, draft, ctx.from.id);
});

bot.action(/^fill_ocr_(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];
  await ctx.answerCbQuery();
  const draft = await AuctionDraft.findById(draftId);
  if (!draft) { await ctx.reply('❌ Черновик не найден'); return; }

  await safeDeleteCurrentMessage(ctx);
  stateManager.updateState(ctx, {
    draftId: draft._id,
    category: draft.category,
    manualMode: false
  });
  stateManager.setAwaitingInput(ctx, 'ocrData', { type: 'ocrData' });

  let text;
  if (draft.category === 'horse') {
    text =
      '📸 *Заполнение по фото лошади*\n\n' +
      'Отправьте 1, 2 или 3 скриншота *одним сообщением* (можно сразу несколько):\n' +
      '• Окно Info лошади (Stables → Info)\n' +
      '• Вкладка Mutations (если нужно)\n\n' +
      '*Будут заполнены:*\n' +
      '• Вид (SPECIES)\n' +
      '• Пол (GENDER)\n' +
      '• Размер (SIZE)\n' +
      '• Фертильность (INFERTILE)\n' +
      '• Элдер (ELDER)\n' +
      '• Крылья (WINGS)\n' +
      '• Мутации (MUTATIONS)\n' +
      '• Количество слотов (N/4)\n\n' +
      '⚠️ *Скриншоты должны быть на английском языке!*\n' +
      'Настройки игры (⚙️) → язык → English.';
  } else if (draft.category === 'accessory') {
    text =
      '📸 *Заполнение по фото аксессуара*\n\n' +
      'Отправьте скриншот с информацией об аксессуаре (одно или несколько фото одним сообщением).\n\n' +
      '*Будут заполнены:*\n' +
      '• Название\n' +
      '• Тип\n' +
      '• Тема\n' +
      '• Количество\n\n' +
      '⚠️ *Скриншоты должны быть на английском языке!*';
  } else {
    text =
      '📸 *Заполнение по фото зелья*\n\n' +
      'Отправьте скриншот с информацией о зелье (одно или несколько фото одним сообщением).\n\n' +
      '*Будут заполнены:*\n' +
      '• Название\n' +
      '• Количество\n' +
      '• Категория\n\n' +
      '⚠️ *Скриншоты должны быть на английском языке!*';
  }

  const msg = await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Заполнить вручную', `manual_fill_${draftId}`)],
      [Markup.button.callback('❌ Отменить', 'action_cancel')]
    ])
  });
  stateManager.addTempMessage(ctx, msg.message_id);
});

// ============ APPLY PHOTO DATA ============
bot.action(/^apply_ocr_(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];
  const pendingData = stateManager.getPendingOcr(draftId);
  const alreadyApplied = stateManager.isPendingOcrApplied(draftId);

  if (!pendingData || Object.keys(pendingData).length === 0) {
    if (alreadyApplied) {
      try { await ctx.answerCbQuery('✅ Данные уже применены'); } catch (e) {}
      return;
    }
    try { await ctx.answerCbQuery('❌ Данные не найдены'); } catch (e) {}
    return;
  }

  try {
    await auctionService.updateDraft(draftId, pendingData);
    stateManager.markPendingOcrAsApplied(draftId);
  } catch (dbError) {
    console.error('DB save error:', dbError);
    try { await ctx.answerCbQuery('❌ Ошибка сохранения данных'); } catch (e) {}
    return;
  }

  stateManager.updateState(ctx, {
    pendingOcrData: null,
    ocrMissingFields: null,
    ocrType: null
  });

  try {
    await ctx.editMessageText('✅ *Данные применены!*', { parse_mode: 'Markdown' });
  } catch (e) {}

  try {
    const draft = await AuctionDraft.findById(draftId);
    if (draft) {
      await showAuctionTemplate(ctx, draft.category, draft, ctx.from.id);
      const msg = await ctx.reply(
        '✅ Проверьте заполненные поля и дополните остальные вручную.',
        Markup.inlineKeyboard([
          [Markup.button.callback('✏️ Редактировать', `fill_manual_${draftId}`)]
        ])
      );
      stateManager.addTempMessage(ctx, msg.message_id);
    }
  } catch (e) {}

  try { await ctx.answerCbQuery('✅ Данные применены'); } catch (e) {}
});

bot.action(/^edit_manual_(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];
  await goToManualEdit(ctx, draftId);
});

bot.action('retry_ocr', async (ctx) => {
  await ctx.answerCbQuery();
  stateManager.updateState(ctx, {
    pendingOcrData: null,
    ocrMissingFields: null,
    ocrDraftId: null,
    ocrType: null
  });
  try { await ctx.editMessageText('📸 Отправьте другие фото.'); } catch (e) {}
});

// ============ SHOW TEMPLATE ============
async function showAuctionTemplate(ctx, category, draft, userId) {
  let template, keyboard;
  const user = await User.findOne({ telegramId: userId });
  const sellerInfo = user ? { username: user.username, telegramId: user.telegramId } : null;

  if (category === 'horse') {
    template = formatHorseTemplate(draft.data || {}, sellerInfo, false);
    keyboard = auctionKeyboards.horseEditKeyboard();
  } else if (category === 'accessory') {
    template = formatAccessoryTemplate(draft.data || {}, sellerInfo, false);
    keyboard = auctionKeyboards.accessoryEditKeyboard();
  } else {
    template = formatPotionTemplate(draft.data || {}, sellerInfo, false);
    keyboard = auctionKeyboards.potionEditKeyboard();
  }

  const mainPhoto = draft.data.mainPhoto;
  let msgId;

  if (mainPhoto) {
    const msg = await ctx.telegram.sendPhoto(ctx.chat.id, mainPhoto, {
      caption: template, parse_mode: 'HTML', reply_markup: keyboard.reply_markup
    });
    msgId = msg.message_id;
  } else {
    const msg = await ctx.telegram.sendMessage(ctx.chat.id, template, {
      parse_mode: 'HTML', reply_markup: keyboard.reply_markup
    });
    msgId = msg.message_id;
  }

  stateManager.updateState(ctx, { templateMessageId: msgId });
}

// ============ PHOTO MANAGEMENT ============
bot.action('edit_photos', async (ctx) => {
  await ctx.answerCbQuery();
  const state = stateManager.getState(ctx);
  const draft = await AuctionDraft.findById(state.draftId);
  const tms = stateManager.getTempMessages(ctx);
  await deleteMessages(ctx, tms);
  stateManager.clearTempMessages(ctx);
  await showPhotoMenu(ctx, draft);
});

bot.action('photo_menu_main', async (ctx) => {
  await ctx.answerCbQuery();
  const state = stateManager.getState(ctx);
  const draft = await AuctionDraft.findById(state.draftId);
  await safeDeleteCurrentMessage(ctx);

  const mainPhotoExists = !!draft.data.mainPhoto;
  const buttons = [];

  if (!mainPhotoExists) {
    buttons.push([Markup.button.callback('➕ Добавить', 'photo_main_add')]);
  } else {
    buttons.push([Markup.button.callback('🔄 Заменить', 'photo_main_add')]);
    buttons.push([Markup.button.callback('🗑 Удалить', 'photo_main_delete')]);
  }
  buttons.push([Markup.button.callback('◀️ Назад', 'photo_menu_back')]);

  const msg = await ctx.reply(
    `📷 Основное фото\n\nСтатус: ${mainPhotoExists ? '✅ Установлено' : '❌ Отсутствует'}\n\nОсновное фото отображается в аукционе.`,
    Markup.inlineKeyboard(buttons)
  );
  stateManager.addTempMessage(ctx, msg.message_id);
});

bot.action('photo_main_add', async (ctx) => {
  await ctx.answerCbQuery();
  await safeDeleteCurrentMessage(ctx);
  stateManager.setAwaitingInput(ctx, 'mainPhoto', { type: 'mainPhoto' });
  const msg = await ctx.reply(
    '📷 Отправьте основное фото товара:',
    Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад', 'photo_menu_back')]])
  );
  stateManager.addTempMessage(ctx, msg.message_id);
});

bot.action('photo_main_delete', async (ctx) => {
  await ctx.answerCbQuery();
  const state = stateManager.getState(ctx);
  await safeDeleteCurrentMessage(ctx);
  await auctionService.updateDraft(state.draftId, { mainPhoto: null });
  await updateDraftField(ctx, state.draftId, { mainPhoto: null });
  const msg = await ctx.reply('✅ Основное фото удалено');
  stateManager.addTempMessage(ctx, msg.message_id);
  const draft = await AuctionDraft.findById(state.draftId);
  await showPhotoMenu(ctx, draft);
});

bot.action('photo_menu_params', async (ctx) => {
  await ctx.answerCbQuery();
  const state = stateManager.getState(ctx);
  const draft = await AuctionDraft.findById(state.draftId);
  await safeDeleteCurrentMessage(ctx);

  const paramPhotos = draft.data.paramPhotos || [];
  const count = paramPhotos.length;
  const buttons = [[Markup.button.callback('➕ Добавить', 'photo_params_add')]];

  if (count > 0) {
    buttons.push([Markup.button.callback('🔄 Заменить все', 'photo_params_replace')]);
    buttons.push([Markup.button.callback('🗑 Удалить все', 'photo_params_delete')]);
  }
  buttons.push([Markup.button.callback('◀️ Назад', 'photo_menu_back')]);

  const msg = await ctx.reply(
    `📋 Фото параметров (${count}/10)\n\nФото параметров отображаются в ЛС при нажатии на кнопку "Параметры".\n\n⚠️ *Скриншоты должны быть на английском языке!*`,
    Markup.inlineKeyboard(buttons)
  );
  stateManager.addTempMessage(ctx, msg.message_id);
});

bot.action('photo_params_add', async (ctx) => {
  await ctx.answerCbQuery();
  await safeDeleteCurrentMessage(ctx);
  stateManager.setAwaitingInput(ctx, 'paramPhotos', { type: 'paramPhotos' });
  const msg = await ctx.reply(
    '📋 Отправьте фото параметров (до 10):\nМожно отправлять по одному или несколько сразу.\n\n' +
    '⚠️ *Скриншоты должны быть на английском языке!* Русский интерфейс не проверяется.',
    Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад', 'photo_menu_back')]])
  );
  stateManager.addTempMessage(ctx, msg.message_id);
});

bot.action('photo_params_replace', async (ctx) => {
  await ctx.answerCbQuery();
  await safeDeleteCurrentMessage(ctx);
  const state = stateManager.getState(ctx);
  await auctionService.updateDraft(state.draftId, { paramPhotos: [] });
  stateManager.setAwaitingInput(ctx, 'paramPhotos', { type: 'paramPhotos' });
  const msg = await ctx.reply(
    '📋 Отправьте новые фото параметров (до 10):\n\n' +
    '⚠️ *Скриншоты должны быть на английском языке!*',
    Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад', 'photo_menu_back')]])
  );
  stateManager.addTempMessage(ctx, msg.message_id);
});

bot.action('photo_params_delete', async (ctx) => {
  await ctx.answerCbQuery();
  await safeDeleteCurrentMessage(ctx);
  const state = stateManager.getState(ctx);
  await auctionService.updateDraft(state.draftId, { paramPhotos: [] });
  await updateDraftField(ctx, state.draftId, { paramPhotos: [] });
  const msg = await ctx.reply('✅ Фото параметров удалены');
  stateManager.addTempMessage(ctx, msg.message_id);
  const draft = await AuctionDraft.findById(state.draftId);
  await showPhotoMenu(ctx, draft);
});

bot.action('photo_menu_back', async (ctx) => {
  await ctx.answerCbQuery();
  stateManager.clearAwaitingInput(ctx);
  await safeDeleteCurrentMessage(ctx);
  const state = stateManager.getState(ctx);
  const tms = stateManager.getTempMessages(ctx);
  await deleteMessages(ctx, tms);
  stateManager.clearTempMessages(ctx);
  const draft = await AuctionDraft.findById(state.draftId);
  await showPhotoMenu(ctx, draft);
});

// ============ PAGINATION ============
bot.action(/^(.+)_page_(\d+)$/, async (ctx) => {
  const prefix = ctx.match[1]; const page = parseInt(ctx.match[2]);
  await ctx.answerCbQuery();
  const configs = {
    'species_select': { items: constants.HORSE_SPECIES, title: 'Выберите вид:', backAction: 'species_select_back' },
    'size_select': { items: constants.HORSE_SIZES, title: 'Выберите рост:', backAction: 'edit_back' },
    'wings_select': { items: constants.WINGS, title: 'Выберите крылья:', backAction: 'wings_select_back' },
    'mutation_select': { items: constants.MUTATIONS, title: 'Выберите мутацию:', backAction: 'mutation_select_back' },
    'accessory_name_select': { items: constants.ACCESSORY_ALL, title: 'Выберите аксессуар:', backAction: 'accessory_name_back' },
    'potion_select': { items: constants.POTION_ALL, title: 'Выберите зелье:', backAction: 'potion_name_back' },
    'accessory_type_select': { items: constants.ACCESSORY_TYPES, title: 'Выберите тип:', backAction: 'edit_back' },
    'accessory_theme_select': { items: constants.ACCESSORY_THEMES, title: 'Выберите тему:', backAction: 'edit_back' }
  };
  const cfg = configs[prefix];
  if (!cfg) return;
  try { await ctx.editMessageText(cfg.title, auctionKeyboards.listKeyboard(cfg.items, prefix, cfg.backAction, page)); }
  catch (e) { const msg = await ctx.reply(cfg.title, auctionKeyboards.listKeyboard(cfg.items, prefix, cfg.backAction, page)); stateManager.addTempMessage(ctx, msg.message_id); }
});

// ============ SELECTION HANDLERS ============
bot.action(/^species_select_(\d+)$/, async (ctx) => {
  const v = constants.HORSE_SPECIES[parseInt(ctx.match[1])];
  const s = stateManager.getState(ctx);
  if (!v) return ctx.answerCbQuery('Error');
  deleteAndAnswer(ctx, `Выбрано: ${v}`).catch(() => {});
  await updateDraftField(ctx, s.draftId, { species: v });
});

bot.action(/^size_select_(\d+)$/, async (ctx) => {
  const v = constants.HORSE_SIZES[parseInt(ctx.match[1])];
  const s = stateManager.getState(ctx);
  if (!v) return ctx.answerCbQuery('Error');
  deleteAndAnswer(ctx, `Выбрано: ${v}`).catch(() => {});
  await updateDraftField(ctx, s.draftId, { size: v });
});

bot.action(/^wings_select_(\d+)$/, async (ctx) => {
  const v = constants.WINGS[parseInt(ctx.match[1])];
  const s = stateManager.getState(ctx);
  if (!v) return ctx.answerCbQuery('Error');
  deleteAndAnswer(ctx, `Выбрано: ${v}`).catch(() => {});
  await updateDraftField(ctx, s.draftId, { wings: v });
});

bot.action(/^accessory_name_select_(\d+)$/, async (ctx) => {
  const v = constants.ACCESSORY_ALL[parseInt(ctx.match[1])];
  const s = stateManager.getState(ctx);
  if (!v) return ctx.answerCbQuery('Error');
  deleteAndAnswer(ctx, `Выбрано: ${v}`).catch(() => {});
  await updateDraftField(ctx, s.draftId, { name: v });
});

bot.action(/^potion_select_(\d+)$/, async (ctx) => {
  const v = constants.POTION_ALL[parseInt(ctx.match[1])];
  const s = stateManager.getState(ctx);
  if (!v) return ctx.answerCbQuery('Error');
  deleteAndAnswer(ctx, `Выбрано: ${v}`).catch(() => {});
  await updateDraftField(ctx, s.draftId, { name: v });
});

bot.action(/^accessory_type_select_(\d+)$/, async (ctx) => {
  const v = constants.ACCESSORY_TYPES[parseInt(ctx.match[1])];
  const s = stateManager.getState(ctx);
  if (!v) return ctx.answerCbQuery('Error');
  deleteAndAnswer(ctx, `Выбрано: ${v}`).catch(() => {});
  await updateDraftField(ctx, s.draftId, { accessoryType: v });
});

bot.action(/^accessory_theme_select_(\d+)$/, async (ctx) => {
  const v = constants.ACCESSORY_THEMES[parseInt(ctx.match[1])];
  const s = stateManager.getState(ctx);
  if (!v) return ctx.answerCbQuery('Error');
  deleteAndAnswer(ctx, `Выбрано: ${v}`).catch(() => {});
  await updateDraftField(ctx, s.draftId, { theme: v });
});

// ============ MUTATION SELECT ============
bot.action(/^mutation_select_(\d+)$/, async (ctx) => {
  const index = parseInt(ctx.match[1]);
  const mutation = constants.MUTATIONS[index];
  const state = stateManager.getState(ctx);
  if (!mutation) return ctx.answerCbQuery('Error');

  const slot = state.awaitingInput?.mutationSlot || 1;
  const draft = await AuctionDraft.findById(state.draftId);
  const cur = draft.data.mutations || 'нет';
  const hasWings = draft.data.wings && draft.data.wings !== 'нет';
  const totalSlots = parseInt(draft.data.mutationSlots?.split('/')[0] || '0');
  let arr = cur !== 'нет' ? cur.split(', ').filter(m => m.trim()) : [];
  const isReplacing = !!arr[slot - 1];

  if (!isReplacing) {
    const usedSlots = arr.length + (hasWings ? 1 : 0);
    if (usedSlots >= totalSlots) {
      await ctx.answerCbQuery(`❌ Все слоты заняты (${usedSlots}/${totalSlots}). Крылья тоже занимают слот!`, { show_alert: true });
      return;
    }
  }

  arr[slot - 1] = mutation;
  const str = arr.filter(m => m).join(', ') || 'нет';
  deleteAndAnswer(ctx, `Мутация ${slot}: ${mutation}`).catch(() => {});
  await updateDraftField(ctx, state.draftId, { mutations: str });
});

// ============ ALPHABET FILTER ============
const alphabetConfigs = {
  'species': { items: constants.HORSE_SPECIES, title: 'Виды лошадей' },
  'wings': { items: constants.WINGS, title: 'Крылья' },
  'mutation': { items: constants.MUTATIONS, title: 'Мутации' },
  'accessory': { items: constants.ACCESSORY_ALL, title: 'Аксессуары' },
  'potion': { items: constants.POTION_ALL, title: 'Зелья' }
};

bot.action(/^show_alphabet_(.+)$/, async (ctx) => {
  const type = ctx.match[1]; const cfg = alphabetConfigs[type]; await ctx.answerCbQuery();
  try { await ctx.editMessageText(`Выберите первую букву (${cfg.title}):`, auctionKeyboards.alphabetKeyboard(cfg.items, type, `${type}_alphabet_back`)); }
  catch (e) { const msg = await ctx.reply(`Выберите первую букву (${cfg.title}):`, auctionKeyboards.alphabetKeyboard(cfg.items, type, `${type}_alphabet_back`)); stateManager.addTempMessage(ctx, msg.message_id); }
});

bot.action(/^(.+)_letter_(.+)$/, async (ctx) => {
  const type = ctx.match[1]; const letter = ctx.match[2]; const cfg = alphabetConfigs[type];
  if (!cfg) return ctx.answerCbQuery('Error'); await ctx.answerCbQuery();
  const sp = `${type}_select`;
  try { await ctx.editMessageText(`${cfg.title} на букву "${letter}":`, auctionKeyboards.filteredListKeyboard(cfg.items, sp, letter, `${type}_filtered_back`, 0)); }
  catch (e) { const msg = await ctx.reply(`${cfg.title} на букву "${letter}":`, auctionKeyboards.filteredListKeyboard(cfg.items, sp, letter, `${type}_filtered_back`, 0)); stateManager.addTempMessage(ctx, msg.message_id); }
});

bot.action(/^(.+)_filtered_(.+)_page_(\d+)$/, async (ctx) => {
  const type = ctx.match[1]; const letter = ctx.match[2]; const page = parseInt(ctx.match[3]); const cfg = alphabetConfigs[type];
  if (!cfg) return ctx.answerCbQuery('Error'); await ctx.answerCbQuery();
  const sp = `${type}_select`;
  try { await ctx.editMessageText(`${cfg.title} на букву "${letter}":`, auctionKeyboards.filteredListKeyboard(cfg.items, sp, letter, `${type}_filtered_back`, page)); }
  catch (e) { const msg = await ctx.reply(`${cfg.title} на букву "${letter}":`, auctionKeyboards.filteredListKeyboard(cfg.items, sp, letter, `${type}_filtered_back`, page)); stateManager.addTempMessage(ctx, msg.message_id); }
});

['species', 'wings', 'mutation', 'accessory', 'potion'].forEach(type => {
  bot.action(`${type}_filtered_back`, async (ctx) => { await ctx.answerCbQuery(); const cfg = alphabetConfigs[type];
    try { await ctx.editMessageText(`Выберите первую букву (${cfg.title}):`, auctionKeyboards.alphabetKeyboard(cfg.items, type, `${type}_alphabet_back`)); }
    catch (e) { const msg = await ctx.reply(`Выберите первую букву (${cfg.title}):`, auctionKeyboards.alphabetKeyboard(cfg.items, type, `${type}_alphabet_back`)); stateManager.addTempMessage(ctx, msg.message_id); } });

  bot.action(`${type}_alphabet_back`, async (ctx) => { await ctx.answerCbQuery();
    try { await ctx.editMessageText('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', `show_alphabet_${type}`)], [Markup.button.callback('📋 Весь список', `show_full_${type}`)], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); }
    catch (e) { const msg = await ctx.reply('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', `show_alphabet_${type}`)], [Markup.button.callback('📋 Весь список', `show_full_${type}`)], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); stateManager.addTempMessage(ctx, msg.message_id); } });
});

bot.action('species_select_back', async (ctx) => { await ctx.answerCbQuery(); try { await ctx.editMessageText('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', 'show_alphabet_species')], [Markup.button.callback('📋 Весь список', 'show_full_species')], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); } catch (e) { const msg = await ctx.reply('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', 'show_alphabet_species')], [Markup.button.callback('📋 Весь список', 'show_full_species')], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); stateManager.addTempMessage(ctx, msg.message_id); } });
bot.action('wings_select_back', async (ctx) => { await ctx.answerCbQuery(); try { await ctx.editMessageText('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', 'show_alphabet_wings')], [Markup.button.callback('📋 Весь список', 'show_full_wings')], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); } catch (e) { const msg = await ctx.reply('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', 'show_alphabet_wings')], [Markup.button.callback('📋 Весь список', 'show_full_wings')], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); stateManager.addTempMessage(ctx, msg.message_id); } });
bot.action('mutation_select_back', async (ctx) => { await ctx.answerCbQuery(); await safeDeleteCurrentMessage(ctx); await showMutationSlotMenu(ctx); });
bot.action('accessory_name_back', async (ctx) => { await ctx.answerCbQuery(); try { await ctx.editMessageText('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', 'show_alphabet_accessory')], [Markup.button.callback('📋 Весь список', 'show_full_accessory')], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); } catch (e) { const msg = await ctx.reply('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', 'show_alphabet_accessory')], [Markup.button.callback('📋 Весь список', 'show_full_accessory')], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); stateManager.addTempMessage(ctx, msg.message_id); } });
bot.action('potion_name_back', async (ctx) => { await ctx.answerCbQuery(); try { await ctx.editMessageText('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', 'show_alphabet_potion')], [Markup.button.callback('📋 Весь список', 'show_full_potion')], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); } catch (e) { const msg = await ctx.reply('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', 'show_alphabet_potion')], [Markup.button.callback('📋 Весь список', 'show_full_potion')], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); stateManager.addTempMessage(ctx, msg.message_id); } });

bot.action('cancel_edit', async (ctx) => {
  await ctx.answerCbQuery();
  stateManager.clearAwaitingInput(ctx);
  const state = stateManager.getState(ctx);
  const tms = stateManager.getTempMessages(ctx);
  await deleteMessages(ctx, tms);
  stateManager.clearTempMessages(ctx);
  await safeDeleteCurrentMessage(ctx);
});

bot.action('edit_back', async (ctx) => {
  await ctx.answerCbQuery();
  stateManager.clearAwaitingInput(ctx);
  const state = stateManager.getState(ctx);
  const tms = stateManager.getTempMessages(ctx);
  await deleteMessages(ctx, tms);
  stateManager.clearTempMessages(ctx);
  await safeDeleteCurrentMessage(ctx);
});

// ============ MUTATION SLOT MENU ============
async function showMutationSlotMenu(ctx) {
  const state = stateManager.getState(ctx);
  const draft = await AuctionDraft.findById(state.draftId);
  const cur = draft.data.mutations || 'нет';

  let arr = cur !== 'нет' ? cur.split(', ').filter(m => m.trim()) : [];
  const hasWings = draft.data.wings && draft.data.wings !== 'нет';
  const totalSlots = parseInt(draft.data.mutationSlots?.split('/')[0] || '0');
  const usedSlots = arr.length + (hasWings ? 1 : 0);

  let msg = 'Выберите номер мутации:\n\n';
  msg += `Текущие мутации: ${cur}\n`;
  if (hasWings) msg += `Крылья: ${draft.data.wings} (занимают 1 слот)\n`;
  msg += `Занято слотов: ${usedSlots}/${totalSlots}\n\n`;

  const btns = [
    [Markup.button.callback(`1 Мутация 1 ${arr[0] ? '✓' : ''}`, 'mutation_slot_1')],
    [Markup.button.callback(`2 Мутация 2 ${arr[1] ? '✓' : ''}`, 'mutation_slot_2')],
    [Markup.button.callback(`3 Мутация 3 ${arr[2] ? '✓' : ''}`, 'mutation_slot_3')],
    [Markup.button.callback(`4 Мутация 4 ${arr[3] ? '✓' : ''}`, 'mutation_slot_4')],
    [Markup.button.callback('🗑 Сбросить все', 'mutation_reset_all')],
    [Markup.button.callback('◀️ Назад', 'cancel_edit')]
  ];
  const m = await ctx.reply(msg, Markup.inlineKeyboard(btns));
  stateManager.addTempMessage(ctx, m.message_id);
}

function getAvailableSlots(draft) {
  const mutationSlotsStr = draft.data.mutationSlots || '0/4';
  const selectedSlots = parseInt(mutationSlotsStr.split('/')[0] || '0');
  const hasWings = draft.data.wings && draft.data.wings !== 'нет';
  return selectedSlots - (hasWings ? 1 : 0);
}

function buildSlotHandler(slotNumber) {
  return async (ctx) => {
    await ctx.answerCbQuery();
    const s = stateManager.getState(ctx);
    const draft = await AuctionDraft.findById(s.draftId);
    const available = getAvailableSlots(draft);

    if (available < slotNumber) {
      const reason = `❌ Недостаточно слотов! Доступно для мутаций: ${available}`;
      await ctx.answerCbQuery(reason, { show_alert: true, cache_time: 10 });
      const msg = await ctx.reply(reason);
      setTimeout(async () => { try { await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id); } catch (e) {} }, 3000);
      return;
    }

    stateManager.updateState(ctx, { awaitingInput: { field: 'mutations', mutationSlot: slotNumber, multi: true } });
    await safeDeleteCurrentMessage(ctx);
    await showMutationSearchMenu(ctx);
  };
}

bot.action('mutation_slot_1', buildSlotHandler(1));
bot.action('mutation_slot_2', buildSlotHandler(2));
bot.action('mutation_slot_3', buildSlotHandler(3));
bot.action('mutation_slot_4', buildSlotHandler(4));

bot.action('mutation_reset_all', async (ctx) => {
  await ctx.answerCbQuery();
  const state = stateManager.getState(ctx);
  await auctionService.updateDraft(state.draftId, { mutations: 'нет' });
  const draft = await AuctionDraft.findById(state.draftId);
  const user = await User.findOne({ telegramId: ctx.from.id });
  const sellerInfo = user ? { username: user.username, telegramId: user.telegramId } : null;
  const template = formatHorseTemplate(draft.data, sellerInfo, false);
  const keyboard = auctionKeyboards.horseEditKeyboard();
  try { await ctx.telegram.editMessageText(ctx.chat.id, state.templateMessageId, null, template, { parse_mode: 'HTML', reply_markup: keyboard.reply_markup }); } catch (e) {}
  await safeDeleteCurrentMessage(ctx);
  stateManager.clearAwaitingInput(ctx);
});

async function showMutationSearchMenu(ctx) {
  const state = stateManager.getState(ctx); const slot = state.awaitingInput?.mutationSlot || 1;
  const msg = await ctx.reply(`Выберите способ поиска для мутации ${slot}:`, Markup.inlineKeyboard([
    [Markup.button.callback('🔤 По алфавиту', 'show_alphabet_mutation')],
    [Markup.button.callback('📋 Весь список', 'show_full_mutations')],
    [Markup.button.callback('◀️ Назад', 'mutation_select_back')]
  ]));
  stateManager.addTempMessage(ctx, msg.message_id);
}

// ============ HORSE EDIT ============
bot.action('edit_species', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'species'); const msg = await ctx.reply('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', 'show_alphabet_species')], [Markup.button.callback('📋 Весь список', 'show_full_species')], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action('show_full_species', async (ctx) => { await ctx.answerCbQuery(); try { await ctx.editMessageText('Выберите вид:', auctionKeyboards.listKeyboard(constants.HORSE_SPECIES, 'species_select', 'species_select_back', 0)); } catch (e) { const msg = await ctx.reply('Выберите вид:', auctionKeyboards.listKeyboard(constants.HORSE_SPECIES, 'species_select', 'species_select_back', 0)); stateManager.addTempMessage(ctx, msg.message_id); } });
bot.action('edit_fertility', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'fertility'); const msg = await ctx.reply('Может ли спариваться?', keyboards.yesNoKeyboard('fertility')); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action(/^fertility_(yes|no)$/, async (ctx) => { const v = ctx.match[1] === 'yes' ? 'да' : 'нет'; const s = stateManager.getState(ctx); deleteAndAnswer(ctx).catch(() => {}); await updateDraftField(ctx, s.draftId, { fertility: v }); });
bot.action('edit_gender', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'gender'); const msg = await ctx.reply('Укажите пол:', keyboards.genderKeyboard()); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action(/^gender_(male|female)$/, async (ctx) => { const v = ctx.match[1] === 'male' ? 'мужской' : 'женский'; const s = stateManager.getState(ctx); deleteAndAnswer(ctx).catch(() => {}); await updateDraftField(ctx, s.draftId, { gender: v }); });
bot.action('edit_size', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'size'); const msg = await ctx.reply('Выберите рост:', auctionKeyboards.listKeyboard(constants.HORSE_SIZES, 'size_select', 'edit_back', 0)); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action('edit_wings', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'wings', { defaultValue: 'нет' }); const msg = await ctx.reply('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', 'show_alphabet_wings')], [Markup.button.callback('📋 Весь список', 'show_full_wings')], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action('show_full_wings', async (ctx) => { await ctx.answerCbQuery(); try { await ctx.editMessageText('Выберите крылья:', auctionKeyboards.listKeyboard(constants.WINGS, 'wings_select', 'wings_select_back', 0)); } catch (e) { const msg = await ctx.reply('Выберите крылья:', auctionKeyboards.listKeyboard(constants.WINGS, 'wings_select', 'wings_select_back', 0)); stateManager.addTempMessage(ctx, msg.message_id); } });

bot.action('edit_slots', async (ctx) => {
  await ctx.answerCbQuery();
  stateManager.setAwaitingInput(ctx, 'mutationSlots');
  const msg = await ctx.reply('Выберите количество слотов:', Markup.inlineKeyboard([
    [Markup.button.callback('0/4', 'slots_0'), Markup.button.callback('1/4', 'slots_1')],
    [Markup.button.callback('2/4', 'slots_2'), Markup.button.callback('3/4', 'slots_3')],
    [Markup.button.callback('4/4', 'slots_4')],
    [Markup.button.callback('◀️ Назад', 'cancel_edit')]
  ]));
  stateManager.addTempMessage(ctx, msg.message_id);
});

function buildSlotsHandler(targetSlots, targetLabel) {
  return async (ctx) => {
    await ctx.answerCbQuery();
    const s = stateManager.getState(ctx);
    const draft = await AuctionDraft.findById(s.draftId);
    const mutations = draft.data.mutations || 'нет';
    const hasWings = draft.data.wings && draft.data.wings !== 'нет';
    let arr = mutations !== 'нет' ? mutations.split(', ').filter(m => m.trim()) : [];
    const usedSlots = arr.length + (hasWings ? 1 : 0);

    if (usedSlots > targetSlots) {
      const reason = `❌ Нельзя уменьшить до ${targetLabel}! Занято: ${usedSlots}`;
      await ctx.answerCbQuery(reason, { show_alert: true, cache_time: 10 });
      const msg = await ctx.reply(reason);
      stateManager.addTempMessage(ctx, msg.message_id);
      setTimeout(async () => { try { await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id); } catch (e) {} }, 3000);
      return;
    }

    await updateDraftField(ctx, s.draftId, { mutationSlots: targetLabel });
    await safeDeleteCurrentMessage(ctx);
  };
}

bot.action('slots_0', buildSlotsHandler(0, '0/4'));
bot.action('slots_1', buildSlotsHandler(1, '1/4'));
bot.action('slots_2', buildSlotsHandler(2, '2/4'));
bot.action('slots_3', buildSlotsHandler(3, '3/4'));
bot.action('slots_4', async (ctx) => {
  await ctx.answerCbQuery();
  const s = stateManager.getState(ctx);
  await updateDraftField(ctx, s.draftId, { mutationSlots: '4/4' });
  await safeDeleteCurrentMessage(ctx);
});

bot.action('edit_mutations', async (ctx) => { await ctx.answerCbQuery(); await showMutationSlotMenu(ctx); });
bot.action('show_full_mutations', async (ctx) => { await ctx.answerCbQuery(); try { await ctx.editMessageText('Выберите мутацию:', auctionKeyboards.listKeyboard(constants.MUTATIONS, 'mutation_select', 'mutation_select_back', 0)); } catch (e) { const msg = await ctx.reply('Выберите мутацию:', auctionKeyboards.listKeyboard(constants.MUTATIONS, 'mutation_select', 'mutation_select_back', 0)); stateManager.addTempMessage(ctx, msg.message_id); } });
bot.action('edit_elder', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'elder'); const msg = await ctx.reply('Элдер (старейшина)?', keyboards.yesNoKeyboard('elder')); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action(/^elder_(yes|no)$/, async (ctx) => { const v = ctx.match[1] === 'yes' ? 'да' : 'нет'; const s = stateManager.getState(ctx); deleteAndAnswer(ctx).catch(() => {}); await updateDraftField(ctx, s.draftId, { elder: v }); });

// ============ ACCESSORY/POTION EDIT ============
bot.action('edit_name', async (ctx) => { await ctx.answerCbQuery(); const s = stateManager.getState(ctx); const d = await AuctionDraft.findById(s.draftId); const t = d.category === 'accessory' ? 'accessory' : 'potion'; stateManager.setAwaitingInput(ctx, 'name'); const msg = await ctx.reply('Выберите способ поиска:', Markup.inlineKeyboard([[Markup.button.callback('🔤 По алфавиту', `show_alphabet_${t}`)], [Markup.button.callback('📋 Весь список', `show_full_${t}`)], [Markup.button.callback('◀️ Назад', 'cancel_edit')]])); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action('show_full_accessory', async (ctx) => { await ctx.answerCbQuery(); try { await ctx.editMessageText('Выберите аксессуар:', auctionKeyboards.listKeyboard(constants.ACCESSORY_ALL, 'accessory_name_select', 'accessory_name_back', 0)); } catch (e) { const msg = await ctx.reply('Выберите аксессуар:', auctionKeyboards.listKeyboard(constants.ACCESSORY_ALL, 'accessory_name_select', 'accessory_name_back', 0)); stateManager.addTempMessage(ctx, msg.message_id); } });
bot.action('show_full_potion', async (ctx) => { await ctx.answerCbQuery(); try { await ctx.editMessageText('Выберите зелье:', auctionKeyboards.listKeyboard(constants.POTION_ALL, 'potion_select', 'potion_name_back', 0)); } catch (e) { const msg = await ctx.reply('Выберите зелье:', auctionKeyboards.listKeyboard(constants.POTION_ALL, 'potion_select', 'potion_name_back', 0)); stateManager.addTempMessage(ctx, msg.message_id); } });
bot.action('edit_type', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'accessoryType'); const msg = await ctx.reply('Выберите тип:', auctionKeyboards.listKeyboard(constants.ACCESSORY_TYPES, 'accessory_type_select', 'edit_back', 0)); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action('edit_theme', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'theme'); const msg = await ctx.reply('Выберите тему:', auctionKeyboards.listKeyboard(constants.ACCESSORY_THEMES, 'accessory_theme_select', 'edit_back', 0)); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action('edit_quantity', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'quantity', { validator: 'quantity' }); const msg = await ctx.reply('Введите количество (1-999):', Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад', 'cancel_edit')]])); stateManager.addTempMessage(ctx, msg.message_id); });

// ============ COMMON FIELDS ============
bot.action('edit_currency', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'currency'); const msg = await ctx.reply('Выберите валюту:', keyboards.currencyKeyboard()); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action(/^currency_(rub|hl|cos|da)$/, async (ctx) => { const map = { rub: 'Рубли', hl: 'Серебро [HL]', cos: 'Грибы [CoS]', da: 'Коins [DA]' }; const s = stateManager.getState(ctx); deleteAndAnswer(ctx).catch(() => {}); await updateDraftField(ctx, s.draftId, { currency: map[ctx.match[1]] }); });
bot.action('edit_start_price', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'startPrice', { validator: 'price' }); const msg = await ctx.reply('Введите стартовую цену:', Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад', 'cancel_edit')]])); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action('edit_min_step', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'minStep', { validator: 'price' }); const msg = await ctx.reply('Введите мин. шаг:', Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад', 'cancel_edit')]])); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action('edit_autobuyout', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'autoBuyout', { step: 'autoBuyout' }); const msg = await ctx.reply('Добавить автовыкуп?', keyboards.yesNoKeyboard('autobuyout')); stateManager.addTempMessage(ctx, msg.message_id); });

bot.action('edit_end_date', async (ctx) => {
  await ctx.answerCbQuery();
  const now = moment().utcOffset(3);
  const today = now.format('DD.MM.YYYY'), tomorrow = now.clone().add(1, 'day').format('DD.MM.YYYY'), dayAfter = now.clone().add(2, 'day').format('DD.MM.YYYY'), week1 = now.clone().add(7, 'day').format('DD.MM.YYYY'), week2 = now.clone().add(14, 'day').format('DD.MM.YYYY');
  const msg = await ctx.reply('📅 Выберите дату окончания:\n\nИли введите вручную: ДД.ММ.ГГГГ ЧЧ:ММ', { parse_mode: 'Markdown', ...Markup.inlineKeyboard([
    [Markup.button.callback(`📅 Сегодня (${today})`, 'enddate_today')],
    [Markup.button.callback(`📅 Завтра (${tomorrow})`, 'enddate_tomorrow')],
    [Markup.button.callback(`📅 Послезавтра (${dayAfter})`, 'enddate_dayafter')],
    [Markup.button.callback(`📅 Через неделю (${week1})`, 'enddate_week1')],
    [Markup.button.callback(`📅 2 недели (${week2})`, 'enddate_week2')],
    [Markup.button.callback('⏰ Вручную', 'enddate_manual')],
    [Markup.button.callback('◀️ Назад', 'cancel_edit')]
  ])});
  stateManager.addTempMessage(ctx, msg.message_id);
});

async function setEndDate(ctx, date, time = '23:59') { const s = stateManager.getState(ctx); const ds = `${date} ${time}`; const [dp, tp] = ds.split(' '); const [d, m, y] = dp.split('.'); const [h, min] = tp.split(':'); const ed = moment(`${y}-${m}-${d} ${h}:${min}`, 'YYYY-MM-DD HH:mm').utcOffset(3, true).toDate(); await updateDraftField(ctx, s.draftId, { endDate: ed, endDateFormatted: ds }); await safeDeleteCurrentMessage(ctx); }
bot.action('enddate_today', async (ctx) => { await ctx.answerCbQuery(); await setEndDate(ctx, moment().utcOffset(3).format('DD.MM.YYYY')); });
bot.action('enddate_tomorrow', async (ctx) => { await ctx.answerCbQuery(); await setEndDate(ctx, moment().utcOffset(3).add(1, 'day').format('DD.MM.YYYY')); });
bot.action('enddate_dayafter', async (ctx) => { await ctx.answerCbQuery(); await setEndDate(ctx, moment().utcOffset(3).add(2, 'day').format('DD.MM.YYYY')); });
bot.action('enddate_week1', async (ctx) => { await ctx.answerCbQuery(); await setEndDate(ctx, moment().utcOffset(3).add(7, 'day').format('DD.MM.YYYY')); });
bot.action('enddate_week2', async (ctx) => { await ctx.answerCbQuery(); await setEndDate(ctx, moment().utcOffset(3).add(14, 'day').format('DD.MM.YYYY')); });
bot.action('enddate_manual', async (ctx) => { await ctx.answerCbQuery(); await safeDeleteCurrentMessage(ctx); stateManager.setAwaitingInput(ctx, 'endDate', { validator: 'endDate' }); const msg = await ctx.reply('Введите дату (ДД.ММ.ГГГГ ЧЧ:ММ):', Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад', 'cancel_edit')]])); stateManager.addTempMessage(ctx, msg.message_id); });

bot.action('edit_early_end', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'earlyEnd'); const msg = await ctx.reply('Досрочное окончание?', keyboards.yesNoKeyboard('earlyend')); stateManager.addTempMessage(ctx, msg.message_id); });
bot.action('edit_reserve', async (ctx) => { await ctx.answerCbQuery(); stateManager.setAwaitingInput(ctx, 'reserve', { step: 'reserve' }); const msg = await ctx.reply('Указать бронь?', keyboards.yesNoKeyboard('reserve')); stateManager.addTempMessage(ctx, msg.message_id); });

bot.action(/^autobuyout_(yes|no)$/, async (ctx) => {
  const y = ctx.match[1] === 'yes';
  const s = stateManager.getState(ctx);
  await ctx.answerCbQuery();
  if (y) {
    stateManager.setAwaitingInput(ctx, 'autoBuyoutPrice', { validator: 'price' });
    await ctx.editMessageText('Введите сумму:', Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад', 'cancel_edit')]]));
  } else {
    await updateDraftField(ctx, s.draftId, { autoBuyout: 'нет', autoBuyoutPrice: null });
    await safeDeleteCurrentMessage(ctx);
  }
});
bot.action(/^earlyend_(yes|no)$/, async (ctx) => { deleteAndAnswer(ctx).catch(() => {}); await updateDraftField(ctx, stateManager.getState(ctx).draftId, { earlyEnd: ctx.match[1] === 'yes' ? 'да' : 'нет' }); });
bot.action(/^reserve_(yes|no)$/, async (ctx) => {
  const y = ctx.match[1] === 'yes';
  const s = stateManager.getState(ctx);
  await ctx.answerCbQuery();
  if (y) {
    stateManager.setAwaitingInput(ctx, 'reserveDays', { validator: 'reserveDays' });
    await ctx.editMessageText('Введите срок брони (1-365):', Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад', 'cancel_edit')]]));
  } else {
    await updateDraftField(ctx, s.draftId, { reserve: 'нет', reserveDays: null });
    await safeDeleteCurrentMessage(ctx);
  }
});

['fertility', 'gender', 'elder', 'currency', 'autobuyout', 'earlyend', 'reserve'].forEach(p => { bot.action(`${p}_back`, async (ctx) => { await ctx.answerCbQuery(); stateManager.clearAwaitingInput(ctx); await safeDeleteCurrentMessage(ctx); }); });

// ============ СОХРАНИТЬ ШАБЛОН ============
bot.action('save_template', async (ctx) => {
  await ctx.answerCbQuery();
  const s = stateManager.getState(ctx);
  if (!s?.draftId) { await ctx.reply('❌ Черновик не найден'); return; }

  const draft = await AuctionDraft.findById(s.draftId);
  if (!draft) { await ctx.reply('❌ Черновик не найден'); return; }

  const data = draft.data || {};
  if (!data.species && !data.name) {
    await ctx.reply(
      '❌ Нечего сохранять — заполните хотя бы основные поля.',
      Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад', 'cancel_edit')]])
    );
    return;
  }

  try {
    const { template, created } = await templateService.saveTemplate(
      ctx.from.id, draft.category, data
    );

    const msg = await ctx.reply(
      created
        ? `💾 *Шаблон сохранён!*\n\nИмя: *${template.name}*\nID: #${template._id.toString().slice(-6)}\n\n` +
          `Найти все шаблоны можно в разделе «📋 Мои аукционы» → «📁 Шаблоны».`
        : `💾 *Шаблон обновлён!*\n\nИмя: *${template.name}*`,
      { parse_mode: 'Markdown' }
    );
    stateManager.addTempMessage(ctx, msg.message_id);
  } catch (error) {
    console.error('Save template error:', error);
    await ctx.reply('❌ Ошибка при сохранении шаблона');
  }
});

// ============ PUBLISH & CANCEL ============
bot.action('action_publish', async (ctx) => {
  await ctx.answerCbQuery();
  const s = stateManager.getState(ctx);
  if (!s?.draftId) { await ctx.reply('❌ Черновик не найден'); stateManager.clearState(ctx); return; }
  const d = await AuctionDraft.findById(s.draftId);
  if (!d) { await ctx.reply('❌ Черновик не найден'); stateManager.clearState(ctx); return; }

  const m = validateRequiredFields(d.category, d.data);
  if (m.length > 0) { await ctx.reply(formatMissingFields(m)); return; }

  const isManual = !!s.manualMode;

  if (isManual) {
    const paramPhotos = d.data.paramPhotos || [];
    if (paramPhotos.length === 0) {
      await ctx.reply(
        '❌ *Фото параметров обязательно!*\n\n' +
        'Модерация должна сверить данные на скриншотах с вашим шаблоном.\n\n' +
        '⚠️ *Скриншоты должны быть на английском языке!*\n\n' +
        'Добавьте хотя бы одно фото параметров через кнопку «📸 Фото» → «📋 Фото параметров».',
        { parse_mode: 'Markdown' }
      );
      return;
    }
  }

  // ✅ Пропуск проверки для верифицированного шаблона
  let skipVerification = false;
  if (isManual) {
    try {
      const verified = await templateService.findVerifiedMatch(ctx.from.id, d.data, d.category);
      if (verified) {
        skipVerification = true;
        console.log(`✅ Найден верифицированный шаблон #${verified._id} — пропускаем проверку`);
      }
    } catch (e) {
      console.error('Template check error:', e.message);
    }
  }

  if (skipVerification) {
    try {
      const auction = await auctionService.approveAuction(d._id, 0);

      try {
        await ctx.telegram.sendMessage(
          config.ADMIN_CHAT_ID,
          `✅ *Аукцион опубликован автоматически (по шаблону).*\n\n` +
          `🆔 ID: #${d._id.toString().slice(-6)}\n` +
          `👤 Продавец: @${ctx.from.username || 'нет'} | ${ctx.from.id}\n\n` +
          `[🔗 Перейти к посту](${auction.channelPostUrl || ''})`,
          { parse_mode: 'Markdown', disable_web_page_preview: true }
        );
      } catch (e) {}

      try {
        await ctx.telegram.sendMessage(
          ctx.from.id,
          `✅ Ваш аукцион опубликован на канале!\n\n${auction.channelPostUrl || ''}`
        );
      } catch (e) {}

      const isAdmin = config.ADMIN_IDS.includes(ctx.from.id);
      await ctx.reply('✅ Опубликовано (по сохранённому шаблону).', keyboards.mainMenuKeyboard(isAdmin));
      stateManager.clearState(ctx);
      return;
    } catch (err) {
      console.error('Skip-verification publish error:', err);
      await ctx.reply('⚠️ Не удалось опубликовать автоматически. Отправляю на проверку.');
    }
  }

  await sendToAdminChat(ctx, d, isManual);
  await auctionService.submitForReview(d._id);

  if (isManual) {
    d.data.isManualFill = true;
    await d.save();
  }

  const isAdmin = config.ADMIN_IDS.includes(ctx.from.id);
  await ctx.reply('✅ Отправлено на проверку.', keyboards.mainMenuKeyboard(isAdmin));
  stateManager.clearState(ctx);
});

bot.action('action_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  const s = stateManager.getState(ctx);
  if (s?.draftId) await auctionService.cancelDraft(s.draftId);
  await safeDeleteCurrentMessage(ctx);
  const isAdmin = config.ADMIN_IDS.includes(ctx.from.id);
  await ctx.reply('Создание отменено.', keyboards.mainMenuKeyboard(isAdmin));
  stateManager.clearState(ctx);
});

bot.action(/^fix_draft_(.+)$/, async (ctx) => {
  const draftId = ctx.match[1];
  const d = await AuctionDraft.findById(draftId);
  await ctx.answerCbQuery();
  await ctx.deleteMessage();
  if (!d) { await ctx.reply('❌ Черновик не найден'); return; }
  if (d.status !== 'needs_revision') { await ctx.reply('❌ Не требует доработки'); return; }
  d.status = 'draft';
  d.revisionComment = null;
  await d.save();
  stateManager.createAuctionState(ctx, d.category);
  stateManager.updateState(ctx, { draftId: d._id, category: d.category, manualMode: true });
  await showAuctionTemplate(ctx, d.category, d, ctx.from.id);
  await ctx.reply('🔧 Внесите изменения и нажмите "Опубликовать".');
});

// ============ SEND TO ADMIN ============
async function sendToAdminChat(ctx, draft, isManual = false) {
  const settings = await settingsService.get();
  const user = await User.findOne({ telegramId: draft.userId });
  const si = user ? { username: user.username, telegramId: user.telegramId } : null;
  const db = draft.data.startPrice || '0';

  let t;
  if (draft.category === 'horse') t = formatHorseTemplate({ ...draft.data, currentBid: db, leader: '________' }, si, true);
  else if (draft.category === 'accessory') t = formatAccessoryTemplate({ ...draft.data, currentBid: db, leader: '________' }, si, true);
  else t = formatPotionTemplate({ ...draft.data, currentBid: db, leader: '________' }, si, true);

  const manualBadge = isManual ? '\n✍️ *Режим: ручное заполнение*' : '\n📸 *Режим: фото*';

  const am = `${t}\n\n━━━━━━━━━━━━━━━━\n🆔 ID: #${draft._id.toString().slice(-6)}\n👤 Продавец: @${user?.username || 'нет'} | ${draft.userId}\n📅 Дата: ${moment().format('DD.MM.YYYY HH:mm')} МСК\n📦 Категория: ${draft.category === 'horse' ? 'Лошадь' : draft.category === 'accessory' ? 'Аксессуар' : 'Зелье'}${manualBadge}`;

  if (!isManual) {
    console.log('📸 Заполнено с фото → авто-публикация');

    try {
      if (draft.data.mainPhoto) {
        await ctx.telegram.sendPhoto(config.ADMIN_CHAT_ID, draft.data.mainPhoto, {
          caption: am + '\n\n🚀 *Публикуется автоматически*',
          parse_mode: 'HTML'
        });
      } else {
        await ctx.telegram.sendMessage(config.ADMIN_CHAT_ID, am + '\n\n🚀 *Публикуется автоматически*', {
          parse_mode: 'HTML'
        });
      }
    } catch (e) {
      console.warn('Could not notify admin:', e.message);
    }

    try {
      const auction = await auctionService.approveAuction(draft._id, 0);

      try {
        await ctx.telegram.sendMessage(
          draft.userId,
          `✅ Ваш аукцион опубликован на канале!\n\n${auction.channelPostUrl || ''}`
        );
      } catch (e) {}

      try {
        await ctx.telegram.sendMessage(
          config.ADMIN_CHAT_ID,
          `✅ Аукцион #${draft._id.toString().slice(-6)} опубликован автоматически.\n[🔗 Перейти к посту](${auction.channelPostUrl || ''})`,
          { parse_mode: 'Markdown', disable_web_page_preview: true }
        );
      } catch (e) {}
    } catch (err) {
      console.error('Auto-publish error:', err);
      const keyboardMsg = await ctx.telegram.sendMessage(
        config.ADMIN_CHAT_ID,
        `⚠️ Не удалось опубликовать автоматически: ${err.message}\n\nПроверьте вручную.`,
        keyboards.adminModerationKeyboard(draft._id)
      );
      await AuctionDraft.findByIdAndUpdate(draft._id, { adminKeyboardMsgId: keyboardMsg.message_id });
    }
    return;
  }

  console.log('✍️ Ручное заполнение → проверка');

  if (draft.data.mainPhoto) {
    await ctx.telegram.sendPhoto(config.ADMIN_CHAT_ID, draft.data.mainPhoto, { caption: am, parse_mode: 'HTML' });
  } else {
    await ctx.telegram.sendMessage(config.ADMIN_CHAT_ID, am, { parse_mode: 'HTML' });
  }

  const paramPhotos = draft.data.paramPhotos || [];
  const shouldVerify = settings.autoVerify && paramPhotos.length > 0;

  if (shouldVerify) {
    const waitMsg = await ctx.telegram.sendMessage(
      config.ADMIN_CHAT_ID,
      '⏳ *Обработка...*\n\nСкоро появятся кнопки модерации.',
      { parse_mode: 'Markdown' }
    );

    runVerification(ctx, draft, waitMsg.message_id).catch(err => {
      console.error('Verification error:', err);
    });

    await AuctionDraft.findByIdAndUpdate(draft._id, { adminKeyboardMsgId: waitMsg.message_id });
    return;
  }

  if (paramPhotos.length === 0) {
    await ctx.telegram.sendMessage(
      config.ADMIN_CHAT_ID,
      '⚠️ Продавец не прикрепил фото параметров. Проверка пропущена. Проверьте вручную.',
      { parse_mode: 'Markdown' }
    );
  }

  const keyboardMsg = await ctx.telegram.sendMessage(
    config.ADMIN_CHAT_ID,
    'Действия модерации:',
    keyboards.adminModerationKeyboard(draft._id)
  );

  await AuctionDraft.findByIdAndUpdate(draft._id, { adminKeyboardMsgId: keyboardMsg.message_id });
}

// ============ VERIFICATION ============
async function runVerification(ctx, draft, waitMsgId) {
  const axios = require('axios');

  try {
    const paramPhotos = draft.data.paramPhotos || [];
    if (paramPhotos.length === 0) {
      throw new Error('Нет фото параметров для проверки');
    }

    console.log(`⏳ Проверка: загрузка ${paramPhotos.length} фото`);

    const imageBuffers = [];
    for (const fileId of paramPhotos) {
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const response = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
      imageBuffers.push(Buffer.from(response.data));
    }

    // ШАГ 1: Проверка языка интерфейса
    console.log('🌐 Шаг 1: определение языка');
    const langResult = await checkLanguage(imageBuffers);

    if (langResult.isRussian) {
      console.log('🚫 Обнаружен русский интерфейс — проверка отменена');

      await ctx.telegram.editMessageText(
        config.ADMIN_CHAT_ID,
        waitMsgId,
        null,
        `🚫 *Скриншот на русском языке!*\n\n` +
        `Проверка не запускается для скриншотов с русским интерфейсом игры.\n\n` +
        `Продавцу отправлено требование загрузить английский скриншот.`,
        { parse_mode: 'Markdown' }
      );

      draft.status = 'needs_revision';
      draft.revisionComment = 'Скриншот на русском языке';
      draft.verificationStatus = 'rejected';
      draft.verificationErrors = ['Скриншот на русском языке — не проверяется.'];
      draft.verificationCheckedAt = new Date();
      await draft.save();

      const { Markup } = require('telegraf');
      try {
        await ctx.telegram.sendMessage(
          draft.userId,
          `🚫 *Скриншоты на русском языке не проверяются!*\n\n` +
          `Модерация принимает ТОЛЬКО скриншоты с АНГЛИЙСКИМ интерфейсом игры.\n\n` +
          `*Как исправить:*\n` +
          `1. Зайдите в игру\n` +
          `2. Откройте настройки (⚙️)\n` +
          `3. Смените язык интерфейса на English\n` +
          `4. Сделайте новые скриншоты окна Info\n` +
          `5. Загрузите их заново через «✏️ Исправить»\n\n` +
          `Скриншоты с русским текстом не проверяются.`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✏️ Исправить', `fix_draft_${draft._id}`)]
            ])
          }
        );
      } catch (e) {
        console.error('Failed to notify user (russian):', e.message);
      }

      const keyboardMsg = await ctx.telegram.sendMessage(
        config.ADMIN_CHAT_ID,
        '⚠️ Продавцу отправлено требование загрузить английский скриншот. Если хотите — можете отклонить/одобрить вручную:',
        keyboards.adminModerationKeyboard(draft._id)
      );
      await AuctionDraft.findByIdAndUpdate(draft._id, { adminKeyboardMsgId: keyboardMsg.message_id });
      return;
    }

    // ШАГ 2: Сверка данных с шаблоном
    console.log('✅ Английский интерфейс подтверждён — полная проверка');

    let result;
    try {
      result = await compareWithTemplate(imageBuffers, draft.data, draft.category);
    } catch (compareError) {
      console.error('❌ Все модели проверки недоступны:', compareError.message);

      await ctx.telegram.editMessageText(
        config.ADMIN_CHAT_ID,
        waitMsgId,
        null,
        `⚠️ *Проверка временно недоступна.*\n\n` +
        `Автоматическая проверка не смогла обработать фото (модели перегружены).\n\n` +
        `Проверьте вручную через кнопки ниже.`,
        { parse_mode: 'Markdown' }
      );

      const keyboardMsg = await ctx.telegram.sendMessage(
        config.ADMIN_CHAT_ID,
        'Действия модерации:',
        keyboards.adminModerationKeyboard(draft._id)
      );
      await AuctionDraft.findByIdAndUpdate(draft._id, { adminKeyboardMsgId: keyboardMsg.message_id });
      return;
    }

    if (result.matches) {
      const settings = await settingsService.get();
      const isAutoMode = settings.publishMode === 'auto';

      await ctx.telegram.editMessageText(
        config.ADMIN_CHAT_ID,
        waitMsgId,
        null,
        isAutoMode
          ? '✅ *Проверка пройдена!*\n\nДанные с фото совпадают с шаблоном.\n🚀 Публикую в канал...'
          : '✅ *Проверка пройдена!*\n\nДанные с фото совпадают с шаблоном.\n👮 Ожидайте ручной модерации.',
        { parse_mode: 'Markdown' }
      );

      if (isAutoMode) {
        try {
          const auction = await auctionService.approveAuction(draft._id, 0);

          await ctx.telegram.sendMessage(
            config.ADMIN_CHAT_ID,
            `✅ *Аукцион автоматически опубликован!*\n\n[🔗 Перейти к посту](${auction.channelPostUrl || ''})`,
            { parse_mode: 'Markdown', disable_web_page_preview: true }
          );

          try {
            await ctx.telegram.sendMessage(
              draft.userId,
              `✅ Ваш аукцион прошёл проверку и опубликован на канале!\n\n${auction.channelPostUrl || ''}`
            );
          } catch (e) {}
        } catch (err) {
          console.error('Auto-publish error:', err);
          const keyboardMsg = await ctx.telegram.sendMessage(
            config.ADMIN_CHAT_ID,
            `⚠️ Не удалось опубликовать автоматически: ${err.message}\n\nПроверьте вручную.`,
            keyboards.adminModerationKeyboard(draft._id)
          );
          await AuctionDraft.findByIdAndUpdate(draft._id, { adminKeyboardMsgId: keyboardMsg.message_id });
        }
        return;
      }

      const keyboardMsg = await ctx.telegram.sendMessage(
        config.ADMIN_CHAT_ID,
        'Действия модерации:',
        keyboards.adminModerationKeyboard(draft._id)
      );
      await AuctionDraft.findByIdAndUpdate(draft._id, {
        adminKeyboardMsgId: keyboardMsg.message_id,
        verificationStatus: 'approved',
        verificationErrors: [],
        verificationCheckedAt: new Date()
      });

      try {
        await ctx.telegram.sendMessage(
          draft.userId,
          '✅ Ваш аукцион прошёл проверку! Ожидайте финального одобрения администратора.'
        );
      } catch (e) {}

    } else {
      await ctx.telegram.editMessageText(
        config.ADMIN_CHAT_ID,
        waitMsgId,
        null,
        `❌ *Проверка НЕ пройдена!*\n\nНайдены расхождения:\n${result.errors.map(e => '• ' + e).join('\n')}`,
        { parse_mode: 'Markdown' }
      );

      draft.status = 'needs_revision';
      draft.revisionComment = result.errors.join('\n');
      draft.verificationStatus = 'rejected';
      draft.verificationErrors = result.errors;
      draft.verificationCheckedAt = new Date();
      await draft.save();

      const { Markup } = require('telegraf');
      try {
        await ctx.telegram.sendMessage(
          draft.userId,
          `❌ *Ваш аукцион не прошёл проверку*\n\n` +
          `Найдены расхождения:\n\n${result.errors.map(e => '• ' + e).join('\n')}\n\n` +
          `Исправьте шаблон и отправьте заново.`,
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('✏️ Исправить', `fix_draft_${draft._id}`)]
            ])
          }
        );
      } catch (e) {
        console.error('Failed to notify user:', e.message);
      }

      const keyboardMsg = await ctx.telegram.sendMessage(
        config.ADMIN_CHAT_ID,
        '⚠️ Черновик отправлен продавцу на исправление. Если хотите — можете отклонить/одобрить вручную:',
        keyboards.adminModerationKeyboard(draft._id)
      );
      await AuctionDraft.findByIdAndUpdate(draft._id, { adminKeyboardMsgId: keyboardMsg.message_id });
    }

  } catch (err) {
    console.error('Verification error (outer):', err?.message || err);

    try {
      await ctx.telegram.editMessageText(
        config.ADMIN_CHAT_ID,
        waitMsgId,
        null,
        `⚠️ Проверка не удалась.\n\nПроверьте вручную через кнопки модерации ниже.`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {}

    const keyboardMsg = await ctx.telegram.sendMessage(
      config.ADMIN_CHAT_ID,
      'Действия модерации:',
      keyboards.adminModerationKeyboard(draft._id)
    );
    await AuctionDraft.findByIdAndUpdate(draft._id, { adminKeyboardMsgId: keyboardMsg.message_id });
  }
}

// ============ LANGUAGE CHECK ============
// ✅ Только рабочие модели. Убрали несуществующие (3.6-flash-lite → 404).
// Порядок: от быстрой к медленной. Последняя — самая стабильная (lite).
const VERIFY_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.6-pro'
];

async function checkLanguage(imageBuffers) {
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const buffers = Array.isArray(imageBuffers) ? imageBuffers : [imageBuffers];

  const prompt = `
Ты — детектор языка интерфейса на скриншотах игры Horse Life.
На фото ${buffers.length} скриншот(ов) из игры.

ТВОЯ ЕДИНСТВЕННАЯ ЗАДАЧА: определить, на каком языке интерфейс игры.

Интерфейс СЧИТАЕТСЯ РУССКИМ, если на скриншоте видны ЛЮБЫЕ из этих слов (или их части):
- Стабилы, Стаби, Стабил, Конюшня
- Информация, Требования, Навыки, Мутации, Питомцы
- Возраст, Пол, Специес, Специи, Личность, Источник
- Взрослый, Взрослая, Ребёнок, Жеребёнок
- Женщина, Мужчина, Женский, Мужской
- Размер, Большой, Маленький, Гигантский, Карликовый, Огромный
- Усиления, Усиление
- Найдено, Не найдено, Пассивный, Пассивная
- Краска, Блестящие, Светящийся, Узор, Волосы, Свечение
- Скрестить, Продать, Экипировать, Значение, Название, Поиск
- Снять все снаряжения, Получить всех детей
- День рождения, Разводился
- Любые другие слова на кириллице

ВАЖНО: если хотя бы ОДНО слово интерфейса на русском — это РУССКИЙ интерфейс.

Интерфейс СЧИТАЕТСЯ АНГЛИЙСКИМ, только если ВСЕ видимые слова интерфейса — на английском.

Верни СТРОГО JSON без markdown:
{
  "isRussian": true | false,
  "confidence": 0.0 - 1.0,
  "reason": "краткое объяснение"
}
`;

  const parts = [{ text: prompt }];
  for (const buf of buffers) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } });
  }

  const payload = {
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', temperature: 0.0 }
  };

  let lastError;
  for (const modelName of VERIFY_MODELS) {
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await ai.models.generateContent({ ...payload, model: modelName });
        const text = response.text || '';
        let clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const data = JSON.parse(clean);

        console.log(`🌐 Язык: ${data.isRussian ? 'RUSSIAN' : 'ENGLISH'} (${modelName})`);
        return {
          isRussian: !!data.isRussian,
          confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
          reason: data.reason || ''
        };

      } catch (error) {
        lastError = error;
        const status = error?.status || error?.code || 0;

        if ((status === 503 || status === 429) && attempt < maxAttempts) {
          const delay = 1500 * attempt;
          console.warn(`⚠️ Язык ${modelName} retry ${attempt}/${maxAttempts} через ${delay}ms (status ${status})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.warn(`❌ Язык ${modelName} не удалось: ${error.message}`);
        break;
      }
    }
  }

  console.error('❌ Не удалось определить язык, продолжаем без пометки');
  return { isRussian: false, confidence: 0, reason: 'detector failed' };
}

// ============ COMPARE WITH TEMPLATE ============
async function compareWithTemplate(imageBuffers, templateData, category = 'horse') {
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const buffers = Array.isArray(imageBuffers) ? imageBuffers : [imageBuffers];

  // ✅ Нормализация слотов мутаций: любое N/N или N/M → N/4
  const normalizeSlots = (slots) => {
    if (!slots) return null;
    const m = String(slots).match(/(\d+)\s*\/\s*\d+/);
    if (!m) return String(slots).trim();
    return `${m[1]}/4`;
  };

  const templateSlotsNormalized = normalizeSlots(templateData.mutationSlots);

  // ✅ Не сравниваем поля, которые продавец не указал (—, null, '', 'нет')
  const templateSpecies = templateData.species && templateData.species !== '—' ? templateData.species : null;
  const templateGender = templateData.gender && templateData.gender !== '—' ? templateData.gender : null;
  const templateSize = templateData.size && templateData.size !== '—' ? templateData.size : null;
  const templateFertility = templateData.fertility && templateData.fertility !== '—' ? templateData.fertility : null;
  const templateElder = templateData.elder && templateData.elder !== '—' ? templateData.elder : null;
  const templateWings = templateData.wings && templateData.wings !== '—' && templateData.wings !== 'нет' ? templateData.wings : null;
  const templateMutations = templateData.mutations && templateData.mutations !== '—' && templateData.mutations !== 'нет' ? templateData.mutations : null;

  let prompt;

  if (category === 'horse') {
    prompt = `
Ты — СТРОГИЙ модератор аукциона лошадей в игре Horse Life.
Тебе дано ${buffers.length} скриншот(ов). Скриншоты УЖЕ проверены — они на английском.
Найди ВСЕ расхождения между фото и шаблоном продавца.

ШАБЛОН ПРОДАВЦА (некоторые поля могут быть пустыми — их НЕ нужно проверять):
- Вид (SPECIES): ${templateSpecies || 'НЕ УКАЗАНО — не проверяй'}
- Пол (GENDER): ${templateGender || 'НЕ УКАЗАНО — не проверяй'}
- Размер (SIZE): ${templateSize || 'НЕ УКАЗАНО — не проверяй'}
- Фертильность (INFERTILE): ${templateFertility || 'НЕ УКАЗАНО — не проверяй'}
- Элдер (ELDER): ${templateElder || 'НЕ УКАЗАНО — не проверяй'}
- Крылья (WINGS): ${templateWings || 'НЕ УКАЗАНО — не проверяй'}
- Слоты мутаций: ${templateSlotsNormalized || 'НЕ УКАЗАНО — не проверяй'}
- Мутации: ${templateMutations || 'НЕ УКАЗАНО — не проверяй'}

КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:

1. SPECIES: русское ↔ английское = СОВПАДАЕТ (ГАРГУЛЬЯ = GARGOYLE, ЕДИНОРОГ = UNICORN).

2. GENDER: МУЖСКОЙ = MALE, ЖЕНСКИЙ = FEMALE.

3. SIZE: сравнивай только первое слово до скобок. "DRAFT (ПРОЕКТ)" → "DRAFT".

4. Fertility: ДА → на фото НЕТ INFERTILE; НЕТ → на фото ЕСТЬ INFERTILE.

5. Elder: 
   - Если в шаблоне "да" → на фото должно быть ELDER или AGE: ELDER.
   - Если в шаблоне "нет" → на фото НЕ должно быть ELDER.
   - Если в шаблоне НЕ УКАЗАНО → игнорируй этот параметр, не считай расхождением.

6. Wings: если указаны — должны быть на фото. Если НЕТ → на фото не должно быть.

7. СЛОТЫ МУТАЦИЙ — ОСОБОЕ ПРАВИЛО:
   - Знаменатель ВСЕГДА приводится к 4.
   - Если в шаблоне "3/4", а на фото "3/3" → это ОДИНАКОВО, расхождения НЕТ.
   - Если в шаблоне "2/4", а на фото "2/2" → это ОДИНАКОВО, расхождения НЕТ.
   - Сравнивай ТОЛЬКО ЧИСЛИТЕЛЬ (число слева от "/").
   - Пример: "0/1" = "0/4" = СОВПАДАЕТ, "3/3" = "3/4" = СОВПАДАЕТ, "2/4" ≠ "3/4" = РАСХОЖДЕНИЕ.

8. Mutations: каждая мутация из шаблона ДОЛЖНА быть на фото. Если чего-то нет — расхождение.

9. Если поле в шаблоне НЕ УКАЗАНО (—, null, пусто) — НЕ считай это расхождением. Просто пропусти.

Если не уверен — считай, что расхождение ЕСТЬ (кроме случая #9).

Верни СТРОГО JSON:
{
  "matches": true | false,
  "errors": ["...", "..."]
}
`;
  } else if (category === 'accessory') {
    prompt = `
Ты — СТРОГИЙ модератор аукциона аксессуаров в игре Horse Life.
Тебе дано ${buffers.length} скриншот(ов). Найди ВСЕ расхождения с шаблоном.

ШАБЛОН ПРОДАВЦА (пустые поля НЕ проверяй):
- Название: ${templateData.name || 'НЕ УКАЗАНО — не проверяй'}
- Тип: ${templateData.accessoryType || 'НЕ УКАЗАНО — не проверяй'}
- Тема: ${templateData.theme || 'НЕ УКАЗАНО — не проверяй'}
- Количество: ${templateData.quantity || 'НЕ УКАЗАНО — не проверяй'}

ПРАВИЛА:
1. Название должно совпадать (регистр не важен).
2. Тип должен совпадать, если указан.
3. Тема должна совпадать, если указана.
4. Количество должно совпадать, если указано.

Верни СТРОГО JSON:
{
  "matches": true | false,
  "errors": ["...", "..."]
}
`;
  } else {
    prompt = `
Ты — СТРОГИЙ модератор аукциона зелий в игре Horse Life.
Тебе дано ${buffers.length} скриншот(ов). Найди ВСЕ расхождения с шаблоном.

ШАБЛОН ПРОДАВЦА (пустые поля НЕ проверяй):
- Название: ${templateData.name || 'НЕ УКАЗАНО — не проверяй'}
- Количество: ${templateData.quantity || 'НЕ УКАЗАНО — не проверяй'}

ПРАВИЛА:
1. Название должно совпадать (регистр не важен).
2. Количество должно совпадать, если указано.

Верни СТРОГО JSON:
{
  "matches": true | false,
  "errors": ["...", "..."]
}
`;
  }

  const parts = [{ text: prompt }];
  for (const buf of buffers) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } });
  }

  const payload = {
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', temperature: 0.0 }
  };

  let lastError;
  for (const modelName of VERIFY_MODELS) {
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await ai.models.generateContent({ ...payload, model: modelName });
        const text = response.text || '';
        let clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const data = JSON.parse(clean);

        let errors = Array.isArray(data.errors) ? data.errors : [];

        errors = errors.filter(err => {
          const lower = err.toLowerCase();

          // Фильтр ложных ошибок на слоты мутаций: N/N vs N/4 — это не ошибка
          if (lower.includes('слот') && lower.includes('мутаци')) {
            const numbers = err.match(/(\d+)\s*\/\s*\d+/g);
            if (numbers && numbers.length >= 2) {
              const numerators = numbers.map(n => parseInt(n.split('/')[0]));
              if (numerators[0] === numerators[1]) return false;
            }
          }

          // Фильтр ложных ошибок на elder: шаблон не указан → не считаем ошибкой
          if (lower.includes('элдер') || lower.includes('elder')) {
            if (!templateElder) return false;
          }

          // Фильтр ложных ошибок на fertility: шаблон не указан → не считаем
          if (lower.includes('фертильность') || lower.includes('fertility')) {
            if (!templateFertility) return false;
          }

          // Фильтр ложных ошибок на вид, пол, размер: если шаблон пустой — игнорируем
          if (lower.includes('вид') || lower.includes('species')) {
            if (!templateSpecies) return false;
          }
          if (lower.includes('пол') || lower.includes('gender')) {
            if (!templateGender) return false;
          }
          if (lower.includes('размер') || lower.includes('size')) {
            if (!templateSize) return false;
          }

          return true;
        });

        const matches = errors.length === 0;

        console.log(`✅ Проверка успешна с ${modelName} — matches: ${matches}, errors: ${errors.length}`);

        return {
          matches: matches,
          errors: errors
        };

      } catch (error) {
        lastError = error;
        const status = error?.status || error?.code || 0;

        if ((status === 503 || status === 429) && attempt < maxAttempts) {
          const delay = 1500 * attempt;
          console.warn(`⚠️ Проверка ${modelName} retry ${attempt}/${maxAttempts} через ${delay}ms (status ${status})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.warn(`❌ Проверка ${modelName} не удалась: ${error.message}`);
        break;
      }
    }
  }

  console.error('❌ Проверка: все попытки исчерпаны');
  throw lastError;
}

module.exports = {
  showAuctionTemplate,
  sendToAdminChat,
  runVerification,
  checkLanguage,
  compareWithTemplate
};
