const User = require('../db/models/User');

class PointsService {
  // Начисление баллов за продажу
  async awardForSale(userId, amount) {
    const points = Math.floor(amount * 0.01); // 1% от суммы продажи
    await User.updateOne(
      { telegramId: userId },
      { 
        $inc: { points: points, totalSales: 1 },
        $set: { updatedAt: new Date() }
      }
    );
    return points;
  }

  // Начисление баллов за покупку
  async awardForPurchase(userId, amount) {
    const points = Math.floor(amount * 0.005); // 0.5% от суммы покупки
    await User.updateOne(
      { telegramId: userId },
      { 
        $inc: { points: points, totalPurchases: 1 },
        $set: { updatedAt: new Date() }
      }
    );
    return points;
  }

  // Штраф за нарушение
  async addPenalty(userId, reason) {
    await User.updateOne(
      { telegramId: userId },
      { 
        $inc: { penalties: 1, points: -50 },
        $set: { lastPenaltyAt: new Date(), auctionBanReason: reason }
      }
    );
  }

  // Получить баланс
  async getBalance(userId) {
    const user = await User.findOne({ telegramId: userId });
    return user?.points || 0;
  }

  // Топ продавцов
  async getTopSellers(limit = 10) {
    return User.find()
      .sort({ totalSales: -1 })
      .limit(limit)
      .select('username telegramId points totalSales');
  }
}

module.exports = new PointsService(); 