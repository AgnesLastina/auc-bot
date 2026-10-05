const escapeMarkdown = (text) => {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
};

const monoFormat = (text) => {
  return '`' + text + '`';
};

const formatDate = (date) => {
  if (!date) return '________';
  const d = new Date(date);
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
  ];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day} ${month} в ${hours}:${minutes} по МСК`;
};

const getDayWord = (days) => {
  if (days % 10 === 1 && days % 100 !== 11) return 'день';
  if (days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 10 || days % 100 >= 20)) return 'дня';
  return 'дней';
};

// ✅ Приведение к КАПСУ, кроме дат и служебных строк
const valueOrDash = (value, defaultValue = '________') => {
  if (value === undefined || value === null || value === '') return defaultValue;

  if (typeof value === 'string') {
    // Не капсим даты (DD.MM.YYYY), МСК-время, "N дня/дней"
    if (/\d{2}\.\d{2}\.\d{4}/.test(value)) return value;
    if (/МСК/.test(value)) return value;
    if (/^\d+\s+(день|дня|дней)$/i.test(value.trim())) return value;
    return value.toUpperCase();
  }

  return value;
};

// ============ ШАБЛОН ЛОШАДИ ============
const formatHorseTemplate = (data, sellerInfo = null, isPublished = false) => {
  const safeData = data || {};
  const dash = isPublished ? 'нет' : '________';

  const species = valueOrDash(safeData.species, dash);
  const fertility = valueOrDash(safeData.fertility, dash);
  const gender = valueOrDash(safeData.gender, dash);
  const size = valueOrDash(safeData.size, dash);
  const wings = valueOrDash(safeData.wings, dash);
  const mutationSlots = valueOrDash(safeData.mutationSlots, dash);
  const mutations = valueOrDash(safeData.mutations, dash);
  const elder = valueOrDash(safeData.elder, dash);
  const currency = valueOrDash(safeData.currency, dash);
  const startPrice = valueOrDash(safeData.startPrice, dash);
  const minStep = valueOrDash(safeData.minStep, dash);

  let autoBuyoutDisplay = valueOrDash(safeData.autoBuyout, dash);
  if (safeData.autoBuyout === 'да' && safeData.autoBuyoutPrice) {
    autoBuyoutDisplay = safeData.autoBuyoutPrice;
  }

  let endDateDisplay = dash;
  if (safeData.endDate) {
    endDateDisplay = formatDate(safeData.endDate);
  } else if (safeData.endDateFormatted) {
    endDateDisplay = safeData.endDateFormatted;
  }

  const earlyEnd = valueOrDash(safeData.earlyEnd, dash);

  let reserveDisplay = valueOrDash(safeData.reserve, dash);
  if (safeData.reserve === 'да' && safeData.reserveDays) {
    reserveDisplay = `${safeData.reserveDays} ${getDayWord(safeData.reserveDays)}`;
  }

  const currentBid = valueOrDash(safeData.currentBid, dash);
  const leader = valueOrDash(safeData.leader, dash);

  let organizerDisplay = dash;
  if (sellerInfo) {
    organizerDisplay = `@${sellerInfo.username || 'нет'} | ${sellerInfo.telegramId}`;
  }

  let photoStatus = '';
  if (!isPublished) {
    const mainPhotoStatus = safeData.mainPhoto ? '✅' : '❌';
    const paramPhotosCount = (safeData.paramPhotos || []).length;
    photoStatus = '────────────\n' +
      '✎  𝐏𝐇𝐎𝐓𝐎  » ›\n' +
      '› основное фото: ' + mainPhotoStatus + '\n' +
      '› фото параметров: ' + (paramPhotosCount > 0 ? paramPhotosCount + '/10' : '❌') + '\n';
  }

  return '༼ ✎  АУКЦИОН НА ЛОШАДЬ ↴ ༽\n\n' +
    '────────────\n' +
    '✎  𝐌𝐀𝐈𝐍  » ›\n' +
    '› вид: ' + species + '\n' +
    '› фертильность: ' + fertility + '\n' +
    '› пол: ' + gender + '\n' +
    '› размер: ' + size + '\n' +
    '› крылья: ' + wings + '\n' +
    '────────────\n' +
    '✎  𝐌𝐔𝐓𝐀𝐓𝐈𝐎𝐍  » ›\n' +
    '› кол-во слотов: ' + mutationSlots + '\n' +
    '› названия мутаций: ' + mutations + '\n' +
    '› элдер: ' + elder + '\n' +
    '────────────\n' +
    '✎  𝐀𝐔𝐂𝐓𝐈𝐎𝐍  » ›\n' +
    '› ʙᴀᴧюᴛа: ' + currency + '\n' +
    '› нач. ставка: ' + startPrice + '\n' +
    '› мин. подъём: ' + minStep + '\n' +
    '› автовыкуп: ' + autoBuyoutDisplay + '\n' +
    '› конец аукциона: ' + endDateDisplay + '\n' +
    '› досрочное окончание: ' + earlyEnd + '\n' +
    '› бронь: ' + reserveDisplay + '\n' +
    photoStatus +
    '────────────\n' +
    '» текущая ставка: ' + currentBid + '\n' +
    '» лидер: ' + leader + '\n' +
    '────────────\n' +
    '〘 ✆ организатор: ' + organizerDisplay + ' 〙';
};

// ============ ШАБЛОН АКСЕССУАРА ============
const formatAccessoryTemplate = (data, sellerInfo = null, isPublished = false) => {
  const safeData = data || {};
  const dash = isPublished ? 'нет' : '________';

  const name = valueOrDash(safeData.name, dash);
  const accessoryType = valueOrDash(safeData.accessoryType, dash);
  const theme = valueOrDash(safeData.theme, dash);
  const quantity = valueOrDash(safeData.quantity, dash);
  const currency = valueOrDash(safeData.currency, dash);
  const startPrice = valueOrDash(safeData.startPrice, dash);
  const minStep = valueOrDash(safeData.minStep, dash);

  let autoBuyoutDisplay = valueOrDash(safeData.autoBuyout, dash);
  if (safeData.autoBuyout === 'да' && safeData.autoBuyoutPrice) {
    autoBuyoutDisplay = safeData.autoBuyoutPrice;
  }

  let endDateDisplay = dash;
  if (safeData.endDate) {
    endDateDisplay = formatDate(safeData.endDate);
  } else if (safeData.endDateFormatted) {
    endDateDisplay = safeData.endDateFormatted;
  }

  const earlyEnd = valueOrDash(safeData.earlyEnd, dash);

  let reserveDisplay = valueOrDash(safeData.reserve, dash);
  if (safeData.reserve === 'да' && safeData.reserveDays) {
    reserveDisplay = `${safeData.reserveDays} ${getDayWord(safeData.reserveDays)}`;
  }

  const currentBid = valueOrDash(safeData.currentBid, dash);
  const leader = valueOrDash(safeData.leader, dash);

  let organizerDisplay = dash;
  if (sellerInfo) {
    organizerDisplay = `@${sellerInfo.username || 'нет'} | ${sellerInfo.telegramId}`;
  }

  let photoStatus = '';
  if (!isPublished) {
    const mainPhotoStatus = safeData.mainPhoto ? '✅' : '❌';
    photoStatus = '────────────\n' +
      '✎  𝐏𝐇𝐎𝐓𝐎  » ›\n' +
      '› основное фото: ' + mainPhotoStatus + '\n';
  }

  return '༼ ✎  АУКЦИОН НА АКСЕССУАР ↴ ༽\n\n' +
    '────────────\n' +
    '✎  𝐌𝐀𝐈𝐍  » ›\n' +
    '› название: ' + name + '\n' +
    '› тип аксессуара: ' + accessoryType + '\n' +
    '› тема: ' + theme + '\n' +
    '› количество: ' + quantity + '\n' +
    '────────────\n' +
    '✎  𝐀𝐔𝐂𝐓𝐈𝐎𝐍  » ›\n' +
    '› ʙᴀᴧюᴛа: ' + currency + '\n' +
    '› нач. ставка: ' + startPrice + '\n' +
    '› мин. подъём: ' + minStep + '\n' +
    '› автовыкуп: ' + autoBuyoutDisplay + '\n' +
    '› конец аукциона: ' + endDateDisplay + '\n' +
    '› досрочное окончание: ' + earlyEnd + '\n' +
    '› бронь: ' + reserveDisplay + '\n' +
    photoStatus +
    '────────────\n' +
    '» текущая ставка: ' + currentBid + '\n' +
    '» лидер: ' + leader + '\n' +
    '────────────\n' +
    '〘 ✆ организатор: ' + organizerDisplay + ' 〙';
};

// ============ ШАБЛОН ЗЕЛЬЯ ============
const formatPotionTemplate = (data, sellerInfo = null, isPublished = false) => {
  const safeData = data || {};
  const dash = isPublished ? 'нет' : '________';

  const name = valueOrDash(safeData.name, dash);
  const quantity = valueOrDash(safeData.quantity, dash);
  const currency = valueOrDash(safeData.currency, dash);
  const startPrice = valueOrDash(safeData.startPrice, dash);
  const minStep = valueOrDash(safeData.minStep, dash);

  let autoBuyoutDisplay = valueOrDash(safeData.autoBuyout, dash);
  if (safeData.autoBuyout === 'да' && safeData.autoBuyoutPrice) {
    autoBuyoutDisplay = safeData.autoBuyoutPrice;
  }

  let endDateDisplay = dash;
  if (safeData.endDate) {
    endDateDisplay = formatDate(safeData.endDate);
  } else if (safeData.endDateFormatted) {
    endDateDisplay = safeData.endDateFormatted;
  }

  const earlyEnd = valueOrDash(safeData.earlyEnd, dash);

  let reserveDisplay = valueOrDash(safeData.reserve, dash);
  if (safeData.reserve === 'да' && safeData.reserveDays) {
    reserveDisplay = `${safeData.reserveDays} ${getDayWord(safeData.reserveDays)}`;
  }

  const currentBid = valueOrDash(safeData.currentBid, dash);
  const leader = valueOrDash(safeData.leader, dash);

  let organizerDisplay = dash;
  if (sellerInfo) {
    organizerDisplay = `@${sellerInfo.username || 'нет'} | ${sellerInfo.telegramId}`;
  }

  let photoStatus = '';
  if (!isPublished) {
    const mainPhotoStatus = safeData.mainPhoto ? '✅' : '❌';
    photoStatus = '────────────\n' +
      '✎  𝐏𝐇𝐎𝐓𝐎  » ›\n' +
      '› основное фото: ' + mainPhotoStatus + '\n';
  }

  return '༼ ✎  АУКЦИОН НА ЗЕЛЬЕ ↴ ༽\n\n' +
    '────────────\n' +
    '✎  𝐌𝐀𝐈𝐍  » ›\n' +
    '› название: ' + name + '\n' +
    '› количество: ' + quantity + '\n' +
    '────────────\n' +
    '✎  𝐀𝐔𝐂𝐓𝐈𝐎𝐍  » ›\n' +
    '› ʙᴀᴧюᴛа: ' + currency + '\n' +
    '› нач. ставка: ' + startPrice + '\n' +
    '› мин. подъём: ' + minStep + '\n' +
    '› автовыкуп: ' + autoBuyoutDisplay + '\n' +
    '› конец аукциона: ' + endDateDisplay + '\n' +
    '› досрочное окончание: ' + earlyEnd + '\n' +
    '› бронь: ' + reserveDisplay + '\n' +
    photoStatus +
    '────────────\n' +
    '» текущая ставка: ' + currentBid + '\n' +
    '» лидер: ' + leader + '\n' +
    '────────────\n' +
    '〘 ✆ организатор: ' + organizerDisplay + ' 〙';
};

const validateRequiredFields = (category, data) => {
  const missing = [];
  const safeData = data || {};

  if (category === 'horse') {
    if (!safeData.species) missing.push('Вид');
    if (!safeData.fertility) missing.push('Фертильность');
    if (!safeData.gender) missing.push('Пол');
    if (!safeData.size) missing.push('Размер');
    if (!safeData.mutationSlots) missing.push('Кол-во слотов');
    if (!safeData.currency) missing.push('Валюта');
    if (!safeData.startPrice) missing.push('Начальная ставка');
    if (!safeData.endDate) missing.push('Конец аукциона');
  } else if (category === 'accessory') {
    if (!safeData.name) missing.push('Название');
    if (!safeData.accessoryType) missing.push('Тип аксессуара');
    if (!safeData.theme) missing.push('Тема');
    if (!safeData.quantity) missing.push('Количество');
    if (!safeData.currency) missing.push('Валюта');
    if (!safeData.startPrice) missing.push('Начальная ставка');
    if (!safeData.endDate) missing.push('Конец аукциона');
  } else if (category === 'potion') {
    if (!safeData.name) missing.push('Название');
    if (!safeData.quantity) missing.push('Количество');
    if (!safeData.currency) missing.push('Валюта');
    if (!safeData.startPrice) missing.push('Начальная ставка');
    if (!safeData.endDate) missing.push('Конец аукциона');
  }

  return missing;
};

const formatMissingFields = (missing) => {
  return '❌ Невозможно опубликовать аукцион. Заполните обязательные поля:\n\n' + missing.map(f => '• ' + f).join('\n');
};

const cleanTempMessages = async (ctx, messageIds) => {
  if (!messageIds || messageIds.length === 0) return;

  for (const msgId of messageIds) {
    try {
      await ctx.deleteMessage(msgId);
    } catch (e) {
      // Игнорируем ошибки удаления
    }
  }
};

module.exports = {
  escapeMarkdown,
  monoFormat,
  formatHorseTemplate,
  formatAccessoryTemplate,
  formatPotionTemplate,
  validateRequiredFields,
  formatMissingFields,
  cleanTempMessages,
  formatDate,
  getDayWord
};