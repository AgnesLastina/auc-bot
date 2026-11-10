const bot = require('../bot/bot');
const User = require('../db/models/User');
const { Markup } = require('telegraf');

const escapeHtml = (text) => {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

// Универсальная функция отправки с защитой от ошибок приватности
async function safeSendMessage(userId, message, keyboard = null) {
  try {
    if (keyboard) {
      try {
        // Пытаемся отправить с кнопками
        await bot.telegram.sendMessage(userId, message, { 
          parse_mode: 'HTML', 
          disable_web_page_preview: true, 
          reply_markup: keyboard.reply_markup 
        });
      } catch (err) {
        // Если приватность закрыта или кнопка невалидна — отправляем без кнопок
        if (err.message.includes('BUTTON_USER_PRIVACY_RESTRICTED') || err.message.includes('BUTTON_URL_INVALID')) {
          await bot.telegram.sendMessage(userId, message, { 
            parse_mode: 'HTML', 
            disable_web_page_preview: true 
          });
        } else {
          throw err;
        }
      }
    } else {
      // Отправка без кнопок
      await bot.telegram.sendMessage(userId, message, { 
        parse_mode: 'HTML', 
        disable_web_page_preview: true 
      });
    }
  } catch (e) {
    console.log(`Notify error for ${userId}:`, e.message);
  }
}

class NotificationService {
  async notifyNewBid(auction, previousLeader) {
    const displayAmount = auction.currentBidDisplay || auction.currentBid;
    const auctionLink = auction.channelPostUrl || '';
    
    // ========== УВЕДОМЛЕНИЕ ПРОДАВЦУ ==========
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

    // ========== УВЕДОМЛЕНИЕ ПРЕДЫДУЩЕМУ ЛИДЕРУ ==========
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
    
    // ========== УВЕДОМЛЕНИЕ ПРОДАВЦУ ==========
    try {
      const winnerInfo = auction.currentLeader 
        ? `@${auction.currentLeader.username || 'нет'} | ${auction.currentLeader.userId}`
        : 'нет ставок';
      
      let sellerMsg = `<b>🏁 Ваш аукцион завершён!</b>\n\n`;
      if (auctionLink) sellerMsg += `<a href="${auctionLink}">🔗 Перейти к аукциону</a>\n\n`;
      if (auction.endedBy === 'buyout') sellerMsg += `<b>⚡ Автовыкуп</b>\n`;
      sellerMsg += `Победитель: ${winnerInfo}\n`;
      sellerMsg += `Сумма: ${displayAmount} ${escapeHtml(auction.data.currency || '')}`;
      
      const sellerButtons = [];
      if (auction.currentLeader) {
        sellerButtons.push([Markup.button.url('👤 Профиль победителя', `tg://user?id=${auction.currentLeader.userId}`)]);
        sellerButtons.push([Markup.button.url('💬 Написать победителю', `tg://openmessage?user_id=${auction.currentLeader.userId}`)]);
      }
      const sellerKeyboard = sellerButtons.length > 0 ? Markup.inlineKeyboard(sellerButtons) : null;

      await safeSendMessage(auction.userId, sellerMsg, sellerKeyboard);
    } catch (e) {
      console.log('Notify seller ended error:', e.message);
    }
    
    // ========== УВЕДОМЛЕНИЕ ПОБЕДИТЕЛЮ ==========
    if (auction.currentLeader) {
      try {
        const sellerInfo = `@${seller?.username || 'нет'} | ${auction.userId}`;
        
        let winnerMsg = `<b>🎉 Поздравляем! Вы выиграли аукцион!</b>\n\n`;
        if (auctionLink) winnerMsg += `<a href="${auctionLink}">🔗 Перейти к аукциону</a>\n\n`;
        if (auction.endedBy === 'buyout') winnerMsg += `<b>⚡ Автовыкуп</b>\n`;
        winnerMsg += `Сумма: ${displayAmount} ${escapeHtml(auction.data.currency || '')}\n`;
        winnerMsg += `Продавец: ${sellerInfo}`;
        
        const winnerButtons = [
          [Markup.button.url('👤 Профиль продавца', `tg://user?id=${auction.userId}`)],
          [Markup.button.url('💬 Написать продавцу', `tg://openmessage?user_id=${auction.userId}`)]
        ];
        
        await safeSendMessage(auction.currentLeader.userId, winnerMsg, Markup.inlineKeyboard(winnerButtons));
      } catch (e) {
        console.log('Notify winner error:', e.message);
      }
    }
    
    // ========== УВЕДОМЛЕНИЕ ПОДПИСЧИКАМ ==========
    if (auction.watchers && auction.watchers.length > 0) {
      for (const watcherId of auction.watchers) {
        if (watcherId === auction.userId) continue;
        if (auction.currentLeader && watcherId === auction.currentLeader.userId) continue;
        
        try {
          let watcherMsg = `<b>📢 Аукцион завершён</b>\n\n`;
          if (auctionLink) watcherMsg += `<a href="${auctionLink}">🔗 Перейти к аукциону</a>\n\n`;
          if (auction.endedBy === 'buyout') watcherMsg += `<b>⚡ Автовыкуп</b>\n`;
          
          watcherMsg += `Победитель: ${auction.currentLeader ? `@${auction.currentLeader.username || 'нет'}` : 'нет ставок'}\n`;
          watcherMsg += `Сумма: ${displayAmount} ${escapeHtml(auction.data.currency || '')}`;
          
          await safeSendMessage(watcherId, watcherMsg);
        } catch (e) {
          console.log('Notify watcher error:', e.message);
        }
      }
    }
  }
}

module.exports = new NotificationService();
