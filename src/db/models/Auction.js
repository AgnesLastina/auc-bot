const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  username: String,
  amount: { type: Number, required: true },
  originalText: String,
  timestamp: { type: Date, default: Date.now }
});

const auctionSchema = new mongoose.Schema({
  draftId: { type: mongoose.Schema.Types.ObjectId, ref: 'AuctionDraft' },
  userId: { type: Number, required: true },
  sellerUsername: String,
  category: { type: String, required: true },
  data: { type: Object, required: true },
  photos: [String],
  
  status: {
    type: String,
    enum: ['active', 'ended', 'cancelled', 'hidden'],
    default: 'active'
  },
  
  currentBid: { type: Number, default: 0 },
  currentBidDisplay: { type: String },
  currentLeader: {
    userId: Number,
    username: String
  },
  bids: [bidSchema],
  watchers: [{ type: Number }],
  
  channelMessageId: Number,
  channelPostUrl: String,
  
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date, required: true },
  
  publishedAt: Date,
  approvedByAdminId: Number,
  
  endedBy: {
    type: String,
    enum: ['auto', 'buyout', 'admin', 'seller', null],
    default: null
  },
  
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Auction', auctionSchema);