const { Markup } = require('telegraf');
const stateManager = require('../../fsm/state.manager');
const AuctionDraft = require('../../db/models/AuctionDraft');

const FIELD_LABELS_HORSE = {
  species: 'Вид',
  gender: 'Пол',
  size: 'Размер',
  fertility: 'Фертильность',
  elder: 'Элдер',
  wings: 'Крылья',
  mutations: 'Мутации',
  mutationSlots: 'Слоты мутаций'
};

const FIELD_LABELS_ACCESSORY = {
  name: 'Название',
  accessoryType: 'Тип',
  theme: 'Тема',
  quantity: 'Количество'
};

const FIELD_LABELS_POTION = {
  name: 'Название',
  quantity: 'Количество',
  potionType: 'Категория'
};

function toUpper(value) {
  if (value === undefined || value === null || value === '') return value;
  return String(value).toUpperCase();
}

async function showOcrPreview(ctx, draftId, parsedData, missingFields, category = 'horse') {
  const FIELD_LABELS =
    category === 'horse' ? FIELD_LABELS_HORSE :
    category === 'accessory' ? FIELD_LABELS_ACCESSORY :
    FIELD_LABELS_POTION;

  const upperData = {};
  for (const [key, val] of Object.entries(parsedData)) {
    if (key === 'quantity' || key === 'mutationSlots') {
      upperData[key] = val;
    } else {
      upperData[key] = toUpper(val);
    }
  }

  let message = '📸 *Результат заполнения:*\n\n';
  let hasData = false;

  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    if (
      upperData[key] !== undefined &&
      upperData[key] !== null &&
      upperData[key] !== '' &&
      upperData[key] !== 'нет'
    ) {
      message += `✅ ${label}: *${upperData[key]}*\n`;
      hasData = true;
    }
  }

  if (!hasData) {
    message = '❌ *Не удалось заполнить ни одного поля.*\n\n' +
      'Убедитесь, что скриншот сделан в окне информации.';
  }

  if (missingFields.length > 0) {
    message += '\n⚠️ *Не заполнено:*\n';
    for (const field of missingFields) {
      message += `• ${field}\n`;
    }
    message += '\nЭти поля можно заполнить вручную.';
  }

  stateManager.setPendingOcr(draftId, upperData);

  stateManager.updateState(ctx, {
    ocrMissingFields: missingFields,
    ocrDraftId: draftId,
    ocrType: category
  });

  const buttons = [];

  if (hasData) {
    buttons.push([Markup.button.callback('✅ Применить заполненное', `apply_ocr_${draftId}`)]);
  }

  buttons.push([Markup.button.callback('✏️ Дозаполнить вручную', `edit_manual_${draftId}`)]);
  buttons.push([Markup.button.callback('🔄 Попробовать другое фото', 'retry_ocr')]);

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
}

async function goToManualEdit(ctx, draftId) {
  await ctx.answerCbQuery();

  stateManager.updateState(ctx, {
    pendingOcrData: null,
    ocrMissingFields: null,
    ocrType: null
  });

  stateManager.clearPendingOcr(draftId);

  const draft = await AuctionDraft.findById(draftId);
  if (!draft) {
    await ctx.reply('❌ Черновик не найден');
    return;
  }

  try { await ctx.deleteMessage(); } catch (e) {}

  try {
    const { showAuctionTemplate } = require('./callback');
    await showAuctionTemplate(ctx, draft.category, draft, ctx.from.id);
  } catch (e) {
    console.error('showAuctionTemplate error:', e.message);
    await ctx.reply('❌ Ошибка при открытии анкеты');
  }
}

module.exports = { showOcrPreview, goToManualEdit };