const mongoose = require('mongoose');

const AuctionDraftSchema = new mongoose.Schema({
  telegramId: Number,

  title: String,
  description: String,
  startPrice: Number,
  bidStep: Number,
  endTime: String,

  photoFileId: String,

  step: {
    type: String,
    default: 'title'
  }
});

module.exports = mongoose.model('AuctionDraft', AuctionDraftSchema);