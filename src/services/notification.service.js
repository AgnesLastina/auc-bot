const bot = require('../bot/bot');
const User = require('../db/models/User');
const { Markup } = require('telegraf');

const escapeHtml = (text) => {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

async function safeSendMessage(userId, message, keyboard = null) {
  const textLen = message ? message.length : 0;
  console.log(`\n========================================`);
  console.log(`[NOTIFY DEBUG] Попытка отправки сообщения`);
  console.log(`[NOTIFY DEBUG] Получатель (userId): ${userId} (Тип: ${typeof userId})`);
  console.log(`[NOTIFY DEBUG] Длина текста: ${textLen} символов`);
  console.log(`[NOTIFY DEBUG] Наличие кнопок: ${keyboard ? 'ДА' : 'НЕТ'}`);
  
  if (!userId) {
    console.error('❌ [NOTIFY DEBUG] ОШИБКА: userId равен null или undefined!');
    return;
  }

  try {
    // Пытаемся отправить с кнопками (если они есть)
    if (keyboard) {
      console.log(`[NOTIFY DEBUG] Отправка с кнопками...`);
      try {
        const res = await bot.telegram.sendMessage(userId, message, { 
          parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard.reply_markup 
        });
        console.log(`✅ [NOTIFY DEBUG] УСПЕХ! Сообщение с кнопками доставлено. Message ID: ${res.message_id}`);
      } catch (err) {
        console.log(`⚠️ [NOTIFY DEBUG] Ошибка при отправке с кнопками: ${err.message}`);
        
        // Если проблема в кнопках (приватность), пробуем без них
        if (err.message.includes('BUTTON_USER_PRIVACY_RESTRICTED') || err.message.includes('BUTTON_URL_INVALID')) {
          console.log(`[NOTIFY DEBUG] Проблема с кнопками (приватность). Пробуем отправить текст без кнопок...`);
          const res2 = await bot.telegram.sendMessage(userId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
          console.log(`✅ [NOTIFY DEBUG] УСПЕХ! Текст без кнопок доставлен. Message ID: ${res2.message_id}`);
        } else {
          throw err; // Если это другая ошибка (например, бот заблокирован) - пробрасываем наверх
        }
      }
    } else {
      // Отправляем просто текст
      console.log(`[NOTIFY DEBUG] Отправка без кнопок...`);
      const res = await bot.telegram.sendMessage(userId, message, { parse_mode: 'HTML', disable_web_page_preview: true });
      console.log(`✅ [NOTIFY DEBUG] УСПЕХ! Сообщение без кнопок доставлено. Message ID: ${res.message_id}`);
    }
  } catch (e) {
    // Сюда мы попадаем, если отправка провалилась полностью
    console.error(`❌ [NOTIFY DEBUG] КРИТИЧЕСКАЯ ОШИБКА ОТПРАВКИ!`);
    console.error(`[NOTIFY DEBUG] Причина: ${e.message}`);
    console.error(`[NOTIFY DEBUG] Код ошибки: ${e.code || 'нет кода'}`);
  }
  console.log(`========================================\n`);
}

class NotificationService {
  async notifyNewBid(auction, previousLeader) {
    console.log(`\n🔥 [BID DEBUG] Ставка обновлена. ID аукциона: ${auction._id}`);
    console.log(`🔥 [BID DEBUG] Владелец аукциона (кому шлем уведомление): ${auction.userId}`);
    
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
