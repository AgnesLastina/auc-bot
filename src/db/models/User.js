const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  username: { type: String },
  firstName: { type: String },
  lastName: { type: String },
  isAdmin: { type: Boolean, default: false },
  isAuctionBanned: { type: Boolean, default: false },
  auctionBanReason: { type: String },
  auctionBanUntil: { type: Date },
  notificationsEnabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  points: { type: Number, default: 0 },
  totalSales: { type: Number, default: 0 },
  totalPurchases: { type: Number, default: 0 },
  penalties: { type: Number, default: 0 },
  lastPenaltyAt: Date
});

module.exports = mongoose.model('User', userSchema);
