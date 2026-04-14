const Auction = require("../models/Auction");

module.exports = (bot) => {

  setInterval(async () => {

    const now = new Date();

    const expired = await Auction.find({
      status: "active",
      endAt: { $lte: now }
    });

    for (const auction of expired) {

      auction.status = "closed";
      await auction.save();

      await bot.sendMessage(
        auction.sellerId,
        `🏁 Аукцион завершён\n\n🏆 Победитель: ${auction.currentWinnerId}\n💰 ${auction.currentPrice}`
      );

      if (auction.currentWinnerId) {
        await bot.sendMessage(
          auction.currentWinnerId,
          `🎉 Вы выиграли аукцион!\n\n📦 ${auction.title}`
        );
      }
    }

  }, 10000);
};