const bot = require('../bot');
const Auction = require('../../db/models/Auction');
const User = require('../../db/models/User');

// Обработка команды /start params_ID
bot.start(async (ctx, next) => {
  const startPayload = ctx.startPayload;
  
  if (startPayload && startPayload.startsWith('params_')) {
    const auctionId = startPayload.replace('params_', '');
    
    try {
      const auction = await Auction.findById(auctionId);
      if (!auction) {
        await ctx.reply('❌ Аукцион не найден');
        return;
      }
      
      const allPhotos = auction.allPhotos || auction.photos || [];
      
      if (allPhotos.length <= 1) {
        await ctx.reply('❌ Для этой лошади нет дополнительных фото параметров');
        return;
      }
      
      // Получаем информацию о продавце
      const user = await User.findOne({ telegramId: auction.userId });
      const sellerInfo = user ? `@${user.username || 'нет'}` : 'неизвестен';
      
      await ctx.reply(
        '📋 <b>Параметры лошади</b>\n\n' +
        `🐴 Вид: ${auction.data.species || 'Не указан'}\n` +
        `📏 Рост: ${auction.data.size || 'Не указан'}\n` +
        `🚻 Пол: ${auction.data.gender || 'Не указан'}\n` +
        `🪽 Крылья: ${auction.data.wings || 'нет'}\n` +
        `🧬 Мутации: ${auction.data.mutations || 'нет'}\n` +
        `👑 Элдер: ${auction.data.elder || 'нет'}\n\n` +
        `👤 Продавец: ${sellerInfo}\n\n` +
        `📸 Ниже представлены фото параметров:`,
        { parse_mode: 'HTML' }
      );
      
      // Отправляем все фото параметров (начиная со второго)
      const paramsPhotos = allPhotos.slice(1);
      
      if (paramsPhotos.length === 1) {
        await ctx.replyWithPhoto(paramsPhotos[0]);
      } else {
        const mediaGroup = paramsPhotos.map((photo, index) => ({
          type: 'photo',
          media: photo,
          caption: index === 0 ? `📸 Фото параметров лошади (${paramsPhotos.length} шт.)` : ''
        }));
        
        await ctx.replyWithMediaGroup(mediaGroup);
      }
      
      // Кнопка для возврата к аукциону
      if (auction.channelPostUrl) {
        await ctx.reply(
          '🔗 Нажмите кнопку ниже, чтобы перейти к аукциону:',
          {
            reply_markup: {
              inline_keyboard: [[
                { text: '🔗 Перейти к аукциону', url: auction.channelPostUrl }
              ]]
            }
          }
        );
      }
      
    } catch (error) {
      console.error('Horse params error:', error);
      await ctx.reply('❌ Ошибка при загрузке параметров');
    }
    
    return;
  }
  
  // Если это не params_, передаем дальше
  return next();
});