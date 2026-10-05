const mongoose = require('mongoose');

const moderationLogSchema = new mongoose.Schema({
  draftId: { type: mongoose.Schema.Types.ObjectId, ref: 'AuctionDraft' },
  auctionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Auction' },
  adminId: { type: Number, required: true },
  action: {
    type: String,
    enum: ['approve', 'reject', 'revision', 'ban', 'unban', 'hide', 'cancel', 'edit'],
    required: true
  },
  reason: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ModerationLog', moderationLogSchema);