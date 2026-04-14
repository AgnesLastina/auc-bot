const auctionService = require("../services/auctionService");

module.exports = function (bot) {

  bot.on("callback_query", async (query) => {

    if (!query.data.startsWith("bid:")) return;

    const auctionId = query.data.split(":")[1];
    const userId = query.from.id;

    const result = await auctionService.placeBid({
      auctionId,
      userId
    });

    if (!result.ok) {
      if (result.reason === "CLOSED") {
        return bot.answerCallbackQuery(query.id, {
          text: "Аукцион закрыт"
        });
      }

      return bot.answerCallbackQuery(query.id, {
        text: "Ошибка ставки"
      });
    }

    const auction = result.auction;

    await bot.editMessageCaption(
      `🔥 ${auction.title}

💰 ${auction.currentPrice}
🏆 ${auction.currentWinnerId}`,
      {
        chat_id: auction.chatId,
        message_id: auction.messageId,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "💰 Сделать ставку",
                callback_data: `bid:${auction._id}`
              }
            ]
          ]
        }
      }
    );

    return bot.answerCallbackQuery(query.id, {
      text: "Ставка принята"
    });
  });
};