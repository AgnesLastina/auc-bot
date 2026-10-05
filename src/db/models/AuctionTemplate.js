const mongoose = require('mongoose');

const auctionTemplateSchema = new mongoose.Schema({
  userId: { type: Number, required: true, index: true },
  name: { type: String, required: true },
  category: {
    type: String,
    enum: ['horse', 'accessory', 'potion'],
    required: true
  },
  data: { type: Object, required: true },
  contentHash: { type: String, required: true, index: true },
  isVerified: { type: Boolean, default: false },
  usageCount: { type: Number, default: 0 },
  lastUsedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

auctionTemplateSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('AuctionTemplate', auctionTemplateSchema);