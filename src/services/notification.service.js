const bot = require('../bot/bot');
const User = require('../db/models/User');
const { Markup } = require('telegraf');

const escapeCurrency = (text) => {
  if (!text) return '';
  return text.replace(/\[/g, '\\[');
};

const escapeHtml = (text) => {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

class NotificationService {
 async notifyNewBid(auction, previousLeader) {
  try {
    const seller = await User.findOne({ telegramId: auction.userId });
    const displayAmount = auction.currentBidDisplay || auction.currentBid;
    
    const buttons = [];
    if (auction.currentLeader) {
      buttons.push([Markup.button.url('👤 Профиль участника', `tg://user?id=${auction.currentLeader.userId}`)]);
      buttons.push([Markup.button.url('💬 Написать участнику', `tg://openmessage?user_id=${auction.currentLeader.userId}`)]);
    }
    const keyboard = buttons.length > 0 ? Markup.inlineKeyboard(buttons) : null;
    
    const auctionLink = auction.channelPostUrl || '';
    
    let message = `<b>💰 Новая ставка!</b>\n\n`;
    if (auctionLink) {
      message += `<a href="${auctionLink}">🔗 Перейти к аукциону</a>\n\n`;
    }
    message += `Ставка: ${displayAmount} ${escapeHtml(auction.data.currency || '')}\n`;
    message += `Участник: @${auction.currentLeader?.username || 'нет'} | ${auction.currentLeader?.userId || ''}`;
    
    await bot.telegram.sendMessage(
      auction.userId,
      message,
      { 
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(keyboard && { reply_markup: keyboard.reply_markup })
      }
    );
  } catch (e) {
    console.log('Notify seller error:', e.message);
  }
  
  if (previousLeader && previousLeader.userId !== auction.currentLeader?.userId) {
    try {
      const displayAmount = auction.currentBidDisplay || auction.currentBid;
      const auctionLink = auction.channelPostUrl || '';
      
      let message = `<b>⚠️ Вашу ставку перебили!</b>\n\n`;
      if (auctionLink) {
        message += `<a href="${auctionLink}">🔗 Перейти к аукциону</a>\n\n`;
      }
      message += `Новая ставка: ${displayAmount} ${escapeHtml(auction.data.currency || '')}\n`;
      message += `Лидер: @${auction.currentLeader?.username || 'нет'}`;
      
      await bot.telegram.sendMessage(
        previousLeader.userId,
        message,
        { parse_mode: 'HTML', disable_web_page_preview: true }
      );
    } catch (e) {
      console.log('Notify previous leader error:', e.message);
    }
  }
}
  
  async notifyAuctionEnded(auction) {
    const seller = await User.findOne({ telegramId: auction.userId });
    const winner = auction.currentLeader ? await User.findOne({ telegramId: auction.currentLeader.userId }) : null;
    
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
      
      let message = `<b>🏁 Ваш аукцион завершён!</b>\n\n`;
      if (auctionLink) {
        message += `<a href="${auctionLink}">🔗 Перейти к аукциону</a>\n\n`;
      }
      
      if (auction.endedBy === 'buyout') {
        message += `<b>⚡ Автовыкуп</b>\n`;
      }
      
      message += `Победитель: ${winnerInfo}\n`;
      message += `Сумма: ${displayAmount} ${escapeHtml(auction.data.currency || '')}`;
      
      const buttons = [];
      if (auction.currentLeader) {
        buttons.push([Markup.button.url('👤 Профиль победителя', `tg://user?id=${auction.currentLeader.userId}`)]);
        buttons.push([Markup.button.url('💬 Написать победителю', `tg://openmessage?user_id=${auction.currentLeader.userId}`)]);
      }
      
      const keyboard = buttons.length > 0 ? Markup.inlineKeyboard(buttons) : null;
      
      await bot.telegram.sendMessage(
        auction.userId,
        message,
        { 
          parse_mode: 'HTML', 
          disable_web_page_preview: true,
          ...(keyboard && { reply_markup: keyboard.reply_markup })
        }
      );
    } catch (e) {
      console.log('Notify seller ended error:', e.message);
    }
    
    // ========== УВЕДОМЛЕНИЕ ПОБЕДИТЕЛЮ ==========
    if (auction.currentLeader) {
      try {
        const sellerInfo = `@${seller?.username || 'нет'} | ${auction.userId}`;
        
        let message = `<b>🎉 Поздравляем! Вы выиграли аукцион!</b>\n\n`;
        if (auctionLink) {
          message += `<a href="${auctionLink}">🔗 Перейти к аукциону</a>\n\n`;
        }
        
        if (auction.endedBy === 'buyout') {
          message += `<b>⚡ Автовыкуп</b>\n`;
        }
        
        message += `Сумма: ${displayAmount} ${escapeHtml(auction.data.currency || '')}\n`;
        message += `Продавец: ${sellerInfo}`;
        
        const buttons = [
          [Markup.button.url('👤 Профиль продавца', `tg://user?id=${auction.userId}`)],
          [Markup.button.url('💬 Написать продавцу', `tg://openmessage?user_id=${auction.userId}`)]
        ];
        
        const keyboard = Markup.inlineKeyboard(buttons);
        
        await bot.telegram.sendMessage(
          auction.currentLeader.userId,
          message,
          { 
            parse_mode: 'HTML', 
            disable_web_page_preview: true,
            reply_markup: keyboard.reply_markup
          }
        );
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
          let message = `<b>📢 Аукцион завершён</b>\n\n`;
          if (auctionLink) {
            message += `<a href="${auctionLink}">🔗 Перейти к аукциону</a>\n\n`;
          }
          
          if (auction.endedBy === 'buyout') {
            message += `<b>⚡ Автовыкуп</b>\n`;
          }
          
          message += `Победитель: ${auction.currentLeader ? `@${auction.currentLeader.username || 'нет'}` : 'нет ставок'}\n`;
          message += `Сумма: ${displayAmount} ${escapeHtml(auction.data.currency || '')}`;
          
          await bot.telegram.sendMessage(
            watcherId,
            message,
            { parse_mode: 'HTML', disable_web_page_preview: true }
          );
        } catch (e) {
          console.log('Notify watcher error:', e.message);
        }
      }
    }
  }
}

module.exports = new NotificationService();