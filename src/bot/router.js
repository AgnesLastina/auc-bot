const { AuctionFSM } = require('../fsm/auction.fsm');

function router(bot) {

  console.log('📡 Router loaded');

  // START
  bot.start(async (ctx) => {
    console.log('START triggered');
    return ctx.reply(
      `👋 Привет!\n\n` +
      `Я бот аукционов.\n\n` +
      `Команды:\n` +
      `/create — создать аукцион`
    );
  });

  // CREATE
  bot.command('create', async (ctx) => {
    console.log('CREATE triggered');
    return AuctionFSM.start(ctx);
  });

  // TEXT FSM
  bot.on('text', async (ctx) => {
    const text = ctx.message.text;

    if (!text) return;
    if (text.startsWith('/')) return;

    console.log('TEXT:', text);

    return AuctionFSM.handle(ctx);
  });
}

module.exports = router;