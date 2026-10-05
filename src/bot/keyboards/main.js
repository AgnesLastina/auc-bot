const { Markup } = require('telegraf');

const categoryKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🐴 Лошадь', 'category_horse')],
    [Markup.button.callback('💍 Аксессуар', 'category_accessory')],
    [Markup.button.callback('🧪 Зелье', 'category_potion')],
    [Markup.button.callback('◀️ Назад', 'back_to_main')]
  ]);
};

const yesNoKeyboard = (prefix) => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ Да', `${prefix}_yes`), Markup.button.callback('❌ Нет', `${prefix}_no`)],
    [Markup.button.callback('◀️ Назад', `${prefix}_back`)]
  ]);
};

const genderKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('♂️ Мужской', 'gender_male'), Markup.button.callback('♀️ Женский', 'gender_female')],
    [Markup.button.callback('◀️ Назад', 'gender_back')]
  ]);
};

const currencyKeyboard = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💰 Рубли', 'currency_rub')],
    [Markup.button.callback('🥈 Серебро [HL]', 'currency_hl')],
    [Markup.button.callback('🍄 Грибы [CoS]', 'currency_cos')],
    [Markup.button.callback('🪙 Коины [DA]', 'currency_da')],
    [Markup.button.callback('◀️ Назад', 'currency_back')]
  ]);
};

const auctionBidKeyboard = (auctionId, hasBuyout, category = null) => {
  const botUsername = process.env.BOT_USERNAME || 'HL_automate_bot';

  const buttons = [
    [Markup.button.url('💰 Сделать ставку', `https://t.me/${botUsername}?start=bid_${auctionId}`)],
    [Markup.button.url('🔔 Подписаться', `https://t.me/${botUsername}?start=watch_${auctionId}`)],
    [Markup.button.url('❌ Отменить ставку', `https://t.me/${botUsername}?start=cancelbid_${auctionId}`)]
  ];

  if (hasBuyout) {
    buttons.unshift([Markup.button.url('⚡ Автовыкуп', `https://t.me/${botUsername}?start=buyout_${auctionId}`)]);
  }

  if (category === 'horse') {
    buttons.push([Markup.button.url('📋 Параметры', `https://t.me/${botUsername}?start=params_${auctionId}`)]);
  }

  return Markup.inlineKeyboard(buttons);
};

// ✅ Админ-панель — с кнопкой «⚙️ Настройки бота»
const adminPanelKeyboard = () => {
  return Markup.keyboard([
    ['📝 Ожидают проверки', '🟢 Активные аукционы'],
    ['🚫 Заблокированные', '📋 Логи модерации'],
    ['⚙️ Настройки бота'],
    ['👤 Обычное меню']
  ]).resize();
};

const mainMenuKeyboard = (isAdmin = false) => {
  const buttons = [
    ['🛒 Создать аукцион'],
    ['📋 Мои аукционы', '🎯 Активные участия'],
    ['👤 Профиль', '🔔 Настройки уведомлений'],
    ['🆘 Поддержка / Спор']
  ];

  if (isAdmin) {
    buttons.push(['👑 Админ-панель']);
  }

  return Markup.keyboard(buttons).resize();
};

function adminModerationKeyboard(draftId) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Одобрить', `admin_approve_${draftId}`),
      Markup.button.callback('❌ Отклонить', `admin_reject_${draftId}`)
    ],
    [
      Markup.button.callback('📋 Параметры', `admin_check_params_${draftId}`)
    ],
    [
      Markup.button.callback('✏️ На доработку', `admin_revision_${draftId}`)
    ]
  ]);
}

// Клавиатура настроек бота
function botSettingsKeyboard(settings) {
  const publishModeLabel = settings.publishMode === 'auto'
    ? '🚀 Режим: АВТО-публикация'
    : '👮 Режим: РУЧНАЯ публикация';

  const autoVerifyLabel = settings.autoVerify
    ? '✅ Автопроверка: ВКЛ'
    : '❌ Автопроверка: ВЫКЛ';

  return Markup.inlineKeyboard([
    [Markup.button.callback(publishModeLabel, 'settings_toggle_publish')],
    [Markup.button.callback(autoVerifyLabel, 'settings_toggle_verify')],
    [Markup.button.callback('◀️ Назад', 'settings_back')]
  ]);
}

module.exports = {
  mainMenuKeyboard,
  categoryKeyboard,
  yesNoKeyboard,
  genderKeyboard,
  currencyKeyboard,
  adminModerationKeyboard,
  auctionBidKeyboard,
  adminPanelKeyboard,
  botSettingsKeyboard
};