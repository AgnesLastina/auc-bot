module.exports = async (ctx, next) => {
  await next();
  
  // Удаляем сообщения бота с "⏳", "✅ Успешно" через 3 секунды
  if (ctx.message?.text && (
    ctx.message.text.includes('⏳') || 
    ctx.message.text.includes('✅ Фото успешно') ||
    ctx.message.text.includes('Введите')
  )) {
    // Не удаляем — это информационные сообщения
  }
};