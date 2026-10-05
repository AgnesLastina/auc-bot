const mongoose = require('mongoose');

const botSettingsSchema = new mongoose.Schema({
  _id: { type: String, default: 'global' },
  // Режим публикации:
  //   'auto'   — автоматически публиковать в канал после успешной проверки
  //   'manual' — публиковать только после нажатия «Одобрить»
  publishMode: { type: String, enum: ['auto', 'manual'], default: 'manual' },
  // Автопроверка фото (для ручного заполнения)
  autoVerify: { type: Boolean, default: true },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: Number }
});

module.exports = mongoose.model('BotSettings', botSettingsSchema);