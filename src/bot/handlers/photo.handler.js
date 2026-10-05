const { Markup } = require('telegraf');
const stateManager = require('../../fsm/state.manager');
const AuctionDraft = require('../../db/models/AuctionDraft');

async function showPhotoMenu(ctx, draft) {
  const freshDraft = await AuctionDraft.findById(draft._id);
  if (!freshDraft) {
    await ctx.reply('❌ Черновик не найден');
    return;
  }
  
  const mainPhotoExists = !!freshDraft.data.mainPhoto;
  const paramPhotosCount = (freshDraft.data.paramPhotos || []).length;
  
  let text = '📸 Управление фото\n\n';
  text += '- Основное фото отображается в аукционе.\n';
  
  if (freshDraft.category === 'horse') {
    text += '- Фото параметров у людей отображается в ЛС бота при нажатии на кнопку "Параметры".\n';
  }
  
  const buttons = [];
  
  buttons.push([Markup.button.callback(
    `📷 Основное фото (${mainPhotoExists ? '1/1' : '0/1'})`, 
    'photo_menu_main'
  )]);
  
  if (freshDraft.category === 'horse') {
    buttons.push([Markup.button.callback(
      `📋 Фото параметров (${paramPhotosCount}/10)`, 
      'photo_menu_params'
    )]);
  }
  
  buttons.push([Markup.button.callback('◀️ Назад', 'edit_back')]);
  
  const msg = await ctx.reply(text, Markup.inlineKeyboard(buttons));
  stateManager.addTempMessage(ctx, msg.message_id);
}

module.exports = { showPhotoMenu };