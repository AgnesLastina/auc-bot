const state = require('./state');

class AuctionFSM {

  static start(ctx) {
    const userId = ctx.from.id;

    const session = {
      title: null,
      price: null,
      description: null
    };

    state.set(userId, session);

    return AuctionFSM.render(ctx);
  }

  static render(ctx) {
    const userId = ctx.from.id;
    const data = state.get(userId);

    const text =
`📦 <b>Создание аукциона</b>

📌 Название: ${data.title ?? '—'}
💰 Цена: ${data.price ?? '—'}
📝 Описание: ${data.description ?? '—'}

Выберите, что редактировать:`;

    return ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '✏️ Название', callback_data: 'edit_title' }],
          [{ text: '✏️ Цена', callback_data: 'edit_price' }],
          [{ text: '✏️ Описание', callback_data: 'edit_description' }],
          [{ text: '🚀 Опубликовать', callback_data: 'publish' }]
        ]
      }
    });
  }

  static async handleText(ctx) {
    const userId = ctx.from.id;
    const session = state.get(userId);

    if (!session || !session.editing) return;

    const text = ctx.message.text;

    session[session.editing] = text;
    session.editing = null;

    state.set(userId, session);

    return AuctionFSM.render(ctx);
  }

  static async handleCallback(ctx) {
    const userId = ctx.from.id;
    const session = state.get(userId);

    if (!session) return;

    const action = ctx.callbackQuery.data;

    if (action === 'edit_title') session.editing = 'title';
    if (action === 'edit_price') session.editing = 'price';
    if (action === 'edit_description') session.editing = 'description';

    if (action === 'publish') {
      state.delete(userId);
      return ctx.editMessageText('✅ Аукцион опубликован');
    }

    state.set(userId, session);

    await ctx.answerCbQuery();

    return ctx.reply('✍️ Введите значение:');
  }
}

module.exports = { AuctionFSM };