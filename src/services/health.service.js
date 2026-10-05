@'
const mongoose = require('mongoose');
const bot = require('../bot/bot');
const config = require('../config');

class HealthService {
  constructor() {
    this.lastCheck = Date.now();
    this.errors = 0;
    this.startTime = Date.now();
  }

  async check() {
    try {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.db.admin().ping();
      }
      this.lastCheck = Date.now();
      this.errors = 0;
      return true;
    } catch (e) {
      this.errors++;
      return false;
    }
  }

  getStatus() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    
    return {
      healthy: this.errors < 3,
      uptime: `${hours}h ${minutes}m ${seconds}s`,
      dbConnected: mongoose.connection.readyState === 1,
      errors: this.errors
    };
  }

  async getStats() {
    const Auction = require('../db/models/Auction');
    const AuctionDraft = require('../db/models/AuctionDraft');
    const User = require('../db/models/User');
    
    const [activeAuctions, pendingDrafts, bannedUsers, totalUsers] = await Promise.all([
      Auction.countDocuments({ status: 'active' }),
      AuctionDraft.countDocuments({ status: 'pending_review' }),
      User.countDocuments({ isAuctionBanned: true }),
      User.countDocuments()
    ]);
    
    return { activeAuctions, pendingDrafts, bannedUsers, totalUsers };
  }
}

module.exports = new HealthService();
'@ | Set-Content src/services/health.service.js -Encoding UTF8
Write-Host "✅ health.service.js created!" -ForegroundColor Green