const AuctionDraft = require('../models/AuctionDraft');

class AuctionService {

  constructor(bot) {
    this.bot = bot;
  }

  // =========================
  // START
  // =========================
  async start(msg) {

    await AuctionDraft.findOneAndDelete({ telegramId: msg.from.id });

    await AuctionDraft.create({
      telegramId: msg.from.id,
      step: 'title'
    });

    return this.bot.sendMessage(msg.chat.id, 'Введите название товара:');
  }

  // =========================
  // CANCEL
  // =========================
  async cancel(msg) {

    await AuctionDraft.findOneAndDelete({ telegramId: msg.from.id });

    return this.bot.sendMessage(msg.chat.id, 'Аукцион отменён ❌');
  }

  // =========================
  // MESSAGE ROUTER
  // =========================
  async handleMessage(msg) {

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text || '';

    if (text.startsWith('/')) return;

    const draft = await AuctionDraft.findOne({ telegramId: userId });
    if (!draft) return;

    if (msg.photo) {
      draft.photoFileId = msg.photo[msg.photo.length - 1].file_id;
      await draft.save();
      return this.sendPreview(chatId, draft, msg.from);
    }

    switch (draft.step) {

      case 'title':
        draft.title = text;
        draft.step = 'description';
        break;

      case 'description':
        draft.description = text;
        draft.step = 'startPrice';
        break;

      case 'startPrice':
        if (!this.isNumber(text))
          return this.bot.sendMessage(chatId, '❌ Введите число');

        draft.startPrice = Number(text);
        draft.step = 'bidStep';
        break;

      case 'bidStep':
        if (!this.isNumber(text))
          return this.bot.sendMessage(chatId, '❌ Введите число');

        draft.bidStep = Number(text);
        draft.step = 'endTime';
        break;

      case 'endTime':
        const v = this.validateDate(text);
        if (!v.valid)
          return this.bot.sendMessage(chatId, `❌ ${v.error}`);

        draft.endTime = text;
        draft.step = 'photo';
        break;

      // EDIT MODE
      case 'edit_title':
        draft.title = text;
        draft.step = 'photo';
        break;

      case 'edit_description':
        draft.description = text;
        draft.step = 'photo';
        break;

      case 'edit_startPrice':
        if (!this.isNumber(text))
          return this.bot.sendMessage(chatId, '❌ Введите число');

        draft.startPrice = Number(text);
        draft.step = 'photo';
        break;

      case 'edit_bidStep':
        if (!this.isNumber(text))
          return this.bot.sendMessage(chatId, '❌ Введите число');

        draft.bidStep = Number(text);
        draft.step = 'photo';
        break;

      case 'edit_endTime':
        const v2 = this.validateDate(text);
        if (!v2.valid)
          return this.bot.sendMessage(chatId, `❌ ${v2.error}`);

        draft.endTime = text;
        draft.step = 'photo';
        break;

      default:
        return;
    }

    await draft.save();
    return this.sendPreview(chatId, draft, msg.from);
  }

  // =========================
  // CALLBACKS
  // =========================
  async handleCallback(query) {

    await this.bot.answerCallbackQuery(query.id);

    const data = query.data;
    const chatId = query.message.chat.id;

    const draft = await AuctionDraft.findOne({ telegramId: query.from.id });

    if (!draft && !data.startsWith('approve') && !data.startsWith('reject')) {
      return this.bot.sendMessage(chatId, 'Черновик не найден ❌');
    }

    // =========================
    // SEND TO ADMIN (MODERATION)
    // =========================
    if (data === 'send') {

      const text = this.buildText(draft, query.from);

      await this.bot.sendPhoto(
        process.env.ADMIN_CHAT_ID,
        draft.photoFileId,
        {
          caption: text,
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Одобрить', callback_data: `approve_${draft._id}` },
                { text: '❌ Отклонить', callback_data: `reject_${draft._id}` }
              ]
            ]
          }
        }
      );

      await this.bot.sendMessage(chatId, 'Отправлено на модерацию ✅');

      return;
    }

    // =========================
    // CANCEL
    // =========================
    if (data === 'cancel') {
      await AuctionDraft.deleteOne({ telegramId: query.from.id });
      return this.bot.sendMessage(chatId, 'Отменено ❌');
    }

    // =========================
    // EDIT MENU
    // =========================
    if (data === 'edit') {

      return this.bot.sendMessage(chatId, 'Что изменить?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Название', callback_data: 'edit_title' }],
            [{ text: 'Описание', callback_data: 'edit_description' }],
            [{ text: 'Цена', callback_data: 'edit_startPrice' }],
            [{ text: 'Шаг', callback_data: 'edit_bidStep' }],
            [{ text: 'Время', callback_data: 'edit_endTime' }]
          ]
        }
      });
    }

    // =========================
    // ENTER EDIT MODE
    // =========================
    if (data.startsWith('edit_')) {

      draft.step = data;
      await draft.save();

      const map = {
        edit_title: 'Введите новое название:',
        edit_description: 'Введите новое описание:',
        edit_startPrice: 'Введите новую цену:',
        edit_bidStep: 'Введите новый шаг:',
        edit_endTime: 'Введите новое время (ДД.MM.ГГГГ ЧЧ:ММ)'
      };

      return this.bot.sendMessage(chatId, map[data]);
    }

    // =========================
    // APPROVE
    // =========================
    if (data.startsWith('approve_')) {

      const id = data.split('_')[1];
      const d = await AuctionDraft.findById(id);

      if (!d) return;

      const text = this.buildText(d);

      await this.bot.sendPhoto(
        process.env.AUCTION_CHANNEL_ID,
        d.photoFileId,
        { caption: text }
      );

      await AuctionDraft.deleteOne({ _id: id });

      return this.bot.sendMessage(chatId, 'Опубликовано в канал ✅');
    }

    // =========================
    // REJECT
    // =========================
    if (data.startsWith('reject_')) {

      const id = data.split('_')[1];

      await AuctionDraft.deleteOne({ _id: id });

      return this.bot.sendMessage(chatId, 'Отклонено ❌');
    }
  }

  // =========================
  // PREVIEW
  // =========================
  async sendPreview(chatId, draft, user) {

    const text = this.buildText(draft, user);

    return this.bot.sendPhoto(chatId, draft.photoFileId, {
      caption: text,
      reply_markup: {
        inline_keyboard: [
          [{ text: '✅ Отправить', callback_data: 'send' }],
          [{ text: '✏️ Изменить', callback_data: 'edit' }],
          [{ text: '❌ Отмена', callback_data: 'cancel' }]
        ]
      }
    });
  }

  // =========================
  // TEXT BUILDER
  // =========================
  buildText(draft, user = {}) {

    return `
🔥 АУКЦИОН 🔥

📦 ${draft.title || '—'}
📝 ${draft.description || '—'}
💰 ${draft.startPrice || '—'}
📈 ${draft.bidStep || '—'}
⏰ ${draft.endTime || '—'}

👤 @${user.username || 'нет'}
🆔 ${user.id || ''}
    `;
  }

  // =========================
  // HELPERS
  // =========================
  isNumber(v) {
    return !isNaN(v) && Number(v) > 0;
  }

  validateDate(value) {

    const regex = /^\d{2}\.\d{2}\.\d{4}\s\d{2}:\d{2}$/;

    if (!regex.test(value)) {
      return { valid: false, error: 'Формат ДД.MM.ГГГГ ЧЧ:ММ' };
    }

    const [d, t] = value.split(' ');
    const [day, month, year] = d.split('.').map(Number);
    const [h, m] = t.split(':').map(Number);

    const date = new Date(year, month - 1, day, h, m);

    if (date <= new Date()) {
      return { valid: false, error: 'Дата должна быть в будущем' };
    }

    return { valid: true };
  }
}

module.exports = AuctionService;