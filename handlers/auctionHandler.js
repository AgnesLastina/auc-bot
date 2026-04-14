const AuctionService = require('../services/auctionService');

module.exports = function (bot) {

  const service = new AuctionService(bot);

  bot.onText(/\/auction/, (msg) => service.start(msg));
  bot.onText(/\/cancel/, (msg) => service.cancel(msg));

  bot.on('message', (msg) => service.handleMessage(msg));
  bot.on('callback_query', (q) => service.handleCallback(q));
};