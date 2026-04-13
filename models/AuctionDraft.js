const mongoose = require('mongoose');

const auctionDraftSchema = new mongoose.Schema({
    telegramId: { type: String, required: true },

    step: { type: String, default: 'title' },

    title: String,
    description: String,
    startPrice: String,
    bidStep: String,
    endTime: String,

    photoFileId: String,

    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('AuctionDraft', auctionDraftSchema);