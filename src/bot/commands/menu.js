const bot = require('../bot');
const keyboards = require('../keyboards/main');
const User = require('../../db/models/User');
const { Markup } = require('telegraf');

// Настройки уведомлений
bot.hears('🔔 Настройки уведомлений', async (ctx) => {
  const user = await User.findOne({ telegramId: ctx.from.id });
  const status = user?.notificationsEnabled ? 'включены' : 'выключены';

  await ctx.reply(
    `🔔 *Настройки уведомлений*\n\n` +
    `Текущий статус: ${status}\n\n` +
    `Выберите действие:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Включить уведомления', 'notify_on')],
        [Markup.button.callback('❌ Выключить уведомления', 'notify_off')],
        [Markup.button.callback('◀️ Назад', 'back_to_main')]
      ])
    }
  );
});