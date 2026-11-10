const bot = require('../bot/bot');
const User = require('../db/models/User');
const { Markup } = require('telegraf');

const escapeHtml = (text) => {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

async function safeSendMessage(userId, message, keyboard = null) {
  if (!userId) {
    console.error('❌ ОШИБКА УВЕДОМЛЕНИЯ: userId отсутствует (undefined/null)');
    return;
  }

  try {
    if (keyboard) {
      try {
        console.log(`[Notify] Попытка отправки с кнопками для ${userId}...`);
        await bot.telegram.sendMessage(userId, message, { 
          parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard.reply_markup 
        });
      } catch (err) {
        if (err.message.includes('BUTTON_USER_PRIVACY_RESTRICTED') || err.message.includes('BUTTON_URL_INVALID')) {
          console.log(`[Notify] Ошибка приватности кнопок для ${userId}. Отправляем без кнопок...`);
          await bot.telegram.sendMessage(userId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
        } else {
          throw err;
        }
      }
    } else {
      console.log(`[Notify] Попытка отправки без кнопок для ${userId}...`);
      await bot.telegram.sendMessage(userId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
    }
    console.log(`✅ Уведомление УСПЕШНО доставлено пользователю ${userId}`);
  } catch (e) {
    console.error(`❌ КРИТИЧЕСКАЯ ОШИБКА ОТПРАВКИ для ${userId}:`, e.message);
  }
}

class NotificationService {
  async notifyNewBid(auction, previousLeader) {
    console.log(`[Notify] Вызов notifyNewBid. Продавец: ${auction.userId}`);
    
    const displayAmount = auction.currentBidDisplay || auction.currentBid;
    const auctionLink = auction.channelPostUrl || '';
    
    let sellerMsg = `<b>💰 Новая ставка!</b>\n\n`;
    if (auctionLink) sellerMsg += `<a href="${auctionLink}">🔗 Перейти к аукциону</a>\n\n`;
    sellerMsg += `Ставка: ${displayAmount} ${escapeHtml(auction.data.currency || '')}\n`;
    sellerMsg += `Участник: @${auction.currentLeader?.username || 'нет'} | ${auction.currentLeader?.userId || ''}`;

    const sellerButtons = [];
    if (auction.currentLeader) {
      sellerButtons.push([Markup.button.url('👤 Профиль участника', `tg://user?id=${auction.currentLeader.userId}`)]);
      sellerButtons.push([Markup.button.url('💬 Написать участнику', `tg://openmessage?user_id=${auction.currentLeader.userId}`)]);
    }
    const sellerKeyboard = sellerButtons.length > 0 ? Markup.inlineKeyboard(sellerButtons) : null;

    await safeSendMessage(auction.userId, sellerMsg, sellerKeyboard);

    if (previousLeader && previousLeader.userId !== auction.currentLeader?.userId) {
      let prevMsg = `<b>⚠️ Вашу ставку перебили!</b>\n\n`;
      if (auctionLink) prevMsg += `<a href="${auctionLink}">🔗 Перейти к аукциону</a>\n\n`;
      prevMsg += `Новая ставка: ${displayAmount} ${escapeHtml(auction.data.currency || '')}\n`;
      prevMsg += `Лидер: @${auction.currentLeader?.username || 'нет'}`;
      
      await safeSendMessage(previousLeader.userId, prevMsg);
    }
  }
  
  async notifyAuctionEnded(auction) {
    const seller = await User.findOne({ telegramId: auction.userId });
    let displayAmount = auction.currentBidDisplay || auction.currentBid;
    if (auction.endedBy === 'buyout' && auction.data.autoBuyoutPrice) {
      displayAmount = auction.data.autoBuyoutPrice;
    }
    const auctionLink = auction.channelPostUrl || '';
    
    // Продавцу
    try {
      const winnerInfo = auction.currentLeader 
        ? `@${auction.currentLeader.username || 'нет'} | ${auction.currentLeader.userId}`
        : 'нет ставок';
      
      let sellerMsg = `<b>🏁 Ваш аукцион завершён!</b>\n\n`;
      if (auctionLink) sellerMsg += `<a href="${auctionLink}">🔗 Перейти к аукциону</a>\n\n`;
      if (auction.endedBy === 'buyout') sellerMsg += `<b>⚡ Автовыкуп</b>\n`;
      sellerMsg += `Победитель: ${winnerInfo}\nСумма: ${displayAmount} ${escapeHtml(auction.data.currency || '')}`;
      
      const sellerButtons = [];
      if (auction.currentLeader) {
        sellerButtons.push([Markup.button.url('👤 Профиль победителя', `tg://user?id=${auction.currentLeader.userId}`)]);
        sellerButtons.push([Markup.button.url('💬 Написать победителю', `tg://openmessage?user_id=${auction.currentLeader.userId}`)]);
      }
      await safeSendMessage(auction.userId, sellerMsg, sellerButtons.length ? Markup.inlineKeyboard(sellerButtons) : null);
    } catch (e) { console.error('End seller error:', e.message); }
    
    // Победителю
    if (auction.currentLeader) {
      try {
        const sellerInfo = `@${seller?.username || 'нет'} | ${auction.userId}`;
        let winnerMsg = `<b>🎉 Вы выиграли аукцион!</b>\n\n`;
        if (auctionLink) winnerMsg += `<a href="${auctionLink}">🔗 Перейти к аукциону</a>\n\n`;
        if (auction.endedBy === 'buyout') winnerMsg += `<b>⚡ Автовыкуп</b>\n`;
        winnerMsg += `Сумма: ${displayAmount} ${escapeHtml(auction.data.currency || '')}\nПродавец: ${sellerInfo}`;
        
        const winnerButtons = [
          [Markup.button.url('👤 Профиль продавца', `tg://user?id=${auction.userId}`)],
          [Markup.button.url('💬 Написать продавцу', `tg://openmessage?user_id=${auction.userId}`)]
        ];
        await safeSendMessage(auction.currentLeader.userId, winnerMsg, Markup.inlineKeyboard(winnerButtons));
      } catch (e) { console.error('End winner error:', e.message); }
    }
  }
}

module.exports = new NotificationService();
