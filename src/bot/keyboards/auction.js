const { Markup } = require('telegraf');

const listKeyboard = (items, prefix, backAction, page = 0, itemsPerPage = 11) => {
  const start = page * itemsPerPage;
  const end = Math.min(start + itemsPerPage, items.length);
  const pageItems = items.slice(start, end);

  const buttons = pageItems.map((item, idx) => [
    Markup.button.callback(item, `${prefix}_${start + idx}`)
  ]);

  const navButtons = [];
  if (page > 0) navButtons.push(Markup.button.callback('◀️ Пред.', `${prefix}_page_${page - 1}`));
  if (end < items.length) navButtons.push(Markup.button.callback('След. ▶️', `${prefix}_page_${page + 1}`));
  if (navButtons.length > 0) buttons.push(navButtons);

  buttons.push([Markup.button.callback('◀️ Назад', backAction)]);

  return Markup.inlineKeyboard(buttons);
};

const alphabetKeyboard = (items, prefix, backAction) => {
  const getFirstLetter = (item) => {
    let text = item.replace(/зелье\s*/gi, '').trim();
    return text.charAt(0).toUpperCase();
  };

  const firstLetters = [...new Set(items.map(item => getFirstLetter(item)))]
    .sort((a, b) => a.localeCompare(b, 'ru'));

  const buttons = [];
  let row = [];

  firstLetters.forEach((letter, index) => {
    row.push(Markup.button.callback(letter, `${prefix}_letter_${letter}`));
    if (row.length === 6 || index === firstLetters.length - 1) {
      buttons.push(row);
      row = [];
    }
  });

  buttons.push([Markup.button.callback('◀️ Назад', backAction)]);

  return Markup.inlineKeyboard(buttons);
};

const filteredListKeyboard = (items, prefix, letter, backAction, page = 0, itemsPerPage = 10) => {
  const getFirstLetter = (item) => {
    let text = item.replace(/зелье\s*/gi, '').trim();
    return text.charAt(0).toUpperCase();
  };

  const filteredItems = items.filter(item => getFirstLetter(item) === letter);

  const start = page * itemsPerPage;
  const end = Math.min(start + itemsPerPage, filteredItems.length);
  const pageItems = filteredItems.slice(start, end);

  const buttons = pageItems.map((item) => {
    const originalIndex = items.indexOf(item);
    return [Markup.button.callback(item, `${prefix}_${originalIndex}`)];
  });

  const navButtons = [];
  if (page > 0) navButtons.push(Markup.button.callback('◀️ Пред.', `${prefix}_filtered_${letter}_page_${page - 1}`));
  if (end < filteredItems.length) navButtons.push(Markup.button.callback('След. ▶️', `${prefix}_filtered_${letter}_page_${page + 1}`));
  if (navButtons.length > 0) buttons.push(navButtons);

  buttons.push([Markup.button.callback('◀️ Назад', backAction)]);

  return Markup.inlineKeyboard(buttons);
};

const horseEditKeyboard = () => {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🐴 Вид', 'edit_species'),
      Markup.button.callback('❤️ Фертильность', 'edit_fertility'),
      Markup.button.callback('⚥ Пол', 'edit_gender')
    ],
    [
      Markup.button.callback('📏 Размер', 'edit_size'),
      Markup.button.callback('🪽 Крылья', 'edit_wings'),
      Markup.button.callback('🎰 Кол-во слотов', 'edit_slots')
    ],
    [
      Markup.button.callback('🧬 Названия мутаций', 'edit_mutations'),
      Markup.button.callback('👑 Элдер', 'edit_elder'),
      Markup.button.callback('💱 Валюта', 'edit_currency')
    ],
    [
      Markup.button.callback('💰 Нач. ставка', 'edit_start_price'),
      Markup.button.callback('📈 Мин. подъём', 'edit_min_step'),
      Markup.button.callback('⚡ Автовыкуп', 'edit_autobuyout')
    ],
    [
      Markup.button.callback('📅 Конец аукциона', 'edit_end_date'),
      Markup.button.callback('⏰ Досрочное окончание', 'edit_early_end'),
      Markup.button.callback('🔒 Бронь', 'edit_reserve')
    ],
    [
      Markup.button.callback('📸 Фото', 'edit_photos'),
      Markup.button.callback('✅ Опубликовать', 'action_publish')
    ],
    [
      Markup.button.callback('💾 Сохранить шаблон', 'save_template'),
      Markup.button.callback('❌ Отменить', 'action_cancel')
    ]
  ]);
};

const accessoryEditKeyboard = () => {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📝 Название', 'edit_name'),
      Markup.button.callback('🏷️ Тип', 'edit_type'),
      Markup.button.callback('🎨 Тема', 'edit_theme')
    ],
    [
      Markup.button.callback('🔢 Количество', 'edit_quantity'),
      Markup.button.callback('💱 Валюта', 'edit_currency'),
      Markup.button.callback('💰 Нач. ставка', 'edit_start_price')
    ],
    [
      Markup.button.callback('📈 Мин. подъём', 'edit_min_step'),
      Markup.button.callback('⚡ Автовыкуп', 'edit_autobuyout'),
      Markup.button.callback('📅 Конец аукциона', 'edit_end_date')
    ],
    [
      Markup.button.callback('⏰ Досрочное окончание', 'edit_early_end'),
      Markup.button.callback('🔒 Бронь', 'edit_reserve'),
      Markup.button.callback('📸 Фото', 'edit_photos')
    ],
    [
      Markup.button.callback('✅ Опубликовать', 'action_publish')
    ],
    [
      Markup.button.callback('💾 Сохранить шаблон', 'save_template'),
      Markup.button.callback('❌ Отменить', 'action_cancel')
    ]
  ]);
};

const potionEditKeyboard = () => {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📝 Название', 'edit_name'),
      Markup.button.callback('🔢 Количество', 'edit_quantity'),
      Markup.button.callback('💱 Валюта', 'edit_currency')
    ],
    [
      Markup.button.callback('💰 Нач. ставка', 'edit_start_price'),
      Markup.button.callback('📈 Мин. подъём', 'edit_min_step'),
      Markup.button.callback('⚡ Автовыкуп', 'edit_autobuyout')
    ],
    [
      Markup.button.callback('📅 Конец аукциона', 'edit_end_date'),
      Markup.button.callback('⏰ Досрочное окончание', 'edit_early_end'),
      Markup.button.callback('🔒 Бронь', 'edit_reserve')
    ],
    [
      Markup.button.callback('📸 Фото', 'edit_photos'),
      Markup.button.callback('✅ Опубликовать', 'action_publish')
    ],
    [
      Markup.button.callback('💾 Сохранить шаблон', 'save_template'),
      Markup.button.callback('❌ Отменить', 'action_cancel')
    ]
  ]);
};

/**
 * Клавиатура для ручного дозаполнения полей после OCR.
 */
const ocrManualFillKeyboard = (draftId, missingFields) => {
  const buttons = [];

  const fieldMap = {
    'SPECIES': { label: 'Вид', cb: 'edit_species' },
    'GENDER': { label: 'Пол', cb: 'edit_gender' },
    'SIZE': { label: 'Размер', cb: 'edit_size' },
    'INFERTILE': { label: 'Фертильность', cb: 'edit_fertility' },
    'ELDER': { label: 'Элдер', cb: 'edit_elder' },
    'BUFFS (мутации)': { label: 'Мутации', cb: 'edit_mutations' },
    'Слоты мутаций': { label: 'Слоты мутаций', cb: 'edit_slots' }
  };

  for (const field of missingFields) {
    const cfg = fieldMap[field] || { label: field, cb: 'edit_back' };
    buttons.push([Markup.button.callback(`✏️ ${cfg.label}`, cfg.cb)]);
  }

  buttons.push([Markup.button.callback('✅ Готово', 'ocr_finish')]);

  return Markup.inlineKeyboard(buttons);
};

module.exports = {
  horseEditKeyboard,
  accessoryEditKeyboard,
  potionEditKeyboard,
  listKeyboard,
  alphabetKeyboard,
  filteredListKeyboard,
  ocrManualFillKeyboard
};