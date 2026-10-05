const mongoose = require('mongoose');

const auctionDraftSchema = new mongoose.Schema({
  userId: { type: Number, required: true },
  category: {
    type: String,
    enum: ['horse', 'accessory', 'potion'],
    required: true
  },
  data: {
    // Horse fields
    species: String,
    fertility: String,
    gender: String,
    size: String,
    wings: { type: String },
    mutationSlots: String,
    mutations: { type: String },
    elder: String,

    // Accessory fields
    name: String,
    accessoryType: String,
    theme: String,
    quantity: Number,

    // Common fields
    currency: String,
    startPrice: String,
    minStep: String,
    autoBuyout: { type: String },
    autoBuyoutPrice: String,
    endDate: Date,
    earlyEnd: { type: String },
    reserve: { type: String },
    reserveDays: Number,

    // Photo fields
    mainPhoto: { type: String, default: null },
    paramPhotos: { type: [String], default: [] },

    // Legacy photo field
    photos: [String],

    // ⚠️ Для AI-проверки
    isManualFill: { type: Boolean, default: false }
  },
  status: {
    type: String,
    enum: ['draft', 'pending_review', 'needs_revision', 'rejected', 'approved'],
    default: 'draft'
  },
  adminKeyboardMsgId: { type: Number, default: null },

  // ⚠️ AI-верификация
  aiVerificationStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected', null],
    default: null
  },
  aiVerificationErrors: { type: [String], default: [] },
  aiVerificationCheckedAt: Date,

  revisionComment: String,
  createdAt: { type: Date, default: Date.now },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 48 * 60 * 60 * 1000)
  }
});

auctionDraftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuctionDraft', auctionDraftSchema);