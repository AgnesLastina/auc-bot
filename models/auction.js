const mongoose = require("mongoose");

const AuctionSchema = new mongoose.Schema({
  chatId: String,
  messageId: String,

  sellerId: String,

  title: String,
  description: String,
  photoFileId: String,

  startPrice: Number,
  currentPrice: Number,
  minStep: Number,

  currentWinnerId: String,

  status: {
    type: String,
    default: "active"
  },

  endAt: Date,

  bids: [
    {
      userId: String,
      amount: Number,
      date: { type: Date, default: Date.now }
    }
  ]
});

module.exports = mongoose.model("Auction", AuctionSchema);