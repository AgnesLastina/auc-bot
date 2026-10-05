require('dotenv').config();

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  MONGODB_URI: process.env.MONGODB_URI,
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID,
  CHANNEL_ID: process.env.CHANNEL_ID,
  ADMIN_IDS: (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(Boolean),
  DRAFT_EXPIRY_HOURS: 48,
  MAX_PHOTOS: 10,
  MIN_BID_STEP: 1,
  BID_CHECK_INTERVAL: '*/30 * * * * *', // Every 30 seconds
};