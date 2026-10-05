let cachedUsername = null;
let cachedAt = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 час

async function getBotUsername(bot) {
  const now = Date.now();
  if (cachedUsername && (now - cachedAt) < CACHE_TTL) {
    return cachedUsername;
  }
  const me = await bot.telegram.getMe();
  cachedUsername = me.username;
  cachedAt = now;
  return cachedUsername;
}

module.exports = { getBotUsername };