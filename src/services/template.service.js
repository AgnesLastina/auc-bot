const crypto = require('crypto');
const AuctionTemplate = require('../db/models/AuctionTemplate');

class TemplateService {
  computeHash(data = {}) {
    const normalized = {
      species: (data.species || '').toString().trim(),
      gender: (data.gender || '').toString().trim(),
      size: (data.size || '').toString().trim(),
      fertility: (data.fertility || '').toString().trim(),
      elder: (data.elder || '').toString().trim(),
      wings: (data.wings || '').toString().trim(),
      mutationSlots: (data.mutationSlots || '').toString().trim(),
      mutations: (data.mutations || '').toString().trim(),
      name: (data.name || '').toString().trim(),
      accessoryType: (data.accessoryType || '').toString().trim(),
      theme: (data.theme || '').toString().trim(),
      quantity: (data.quantity || '').toString().trim(),
      currency: (data.currency || '').toString().trim(),
      startPrice: (data.startPrice || '').toString().trim(),
      minStep: (data.minStep || '').toString().trim(),
      autoBuyout: (data.autoBuyout || '').toString().trim(),
      autoBuyoutPrice: (data.autoBuyoutPrice || '').toString().trim(),
      earlyEnd: (data.earlyEnd || '').toString().trim(),
      reserve: (data.reserve || '').toString().trim(),
      reserveDays: (data.reserveDays || '').toString().trim()
      // ❗ mainPhoto, paramPhotos, endDate НЕ включаем — они всегда разные
    };

    const json = JSON.stringify(normalized, Object.keys(normalized).sort());
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  async findVerifiedMatch(userId, data, category) {
    const hash = this.computeHash(data);
    return AuctionTemplate.findOne({
      userId,
      category,
      contentHash: hash,
      isVerified: true
    });
  }

  async saveTemplate(userId, category, data, name = null) {
    const hash = this.computeHash(data);

    let template = await AuctionTemplate.findOne({
      userId,
      category,
      contentHash: hash
    });

    if (template) {
      template.data = data;
      template.updatedAt = new Date();
      await template.save();
      return { template, created: false };
    }

    const autoName = name || this.generateName(category, data);

    template = await AuctionTemplate.create({
      userId,
      category,
      name: autoName,
      data,
      contentHash: hash,
      isVerified: false
    });

    return { template, created: true };
  }

  async markAsVerified(userId, category, data) {
    const hash = this.computeHash(data);
    const result = await AuctionTemplate.updateOne(
      { userId, category, contentHash: hash },
      { isVerified: true, updatedAt: new Date() }
    );
    return result.modifiedCount > 0;
  }

  async listUserTemplates(userId, limit = 20) {
    return AuctionTemplate.find({ userId })
      .sort({ lastUsedAt: -1, createdAt: -1 })
      .limit(limit);
  }

  async getTemplate(templateId, userId) {
    return AuctionTemplate.findOne({ _id: templateId, userId });
  }

  async deleteTemplate(templateId, userId) {
    const result = await AuctionTemplate.deleteOne({ _id: templateId, userId });
    return result.deletedCount > 0;
  }

  async touchTemplate(templateId, userId) {
    await AuctionTemplate.updateOne(
      { _id: templateId, userId },
      { $inc: { usageCount: 1 }, lastUsedAt: new Date() }
    );
  }

  generateName(category, data) {
    let base;
    if (category === 'horse') base = data.species || 'Лошадь';
    else base = data.name || (category === 'accessory' ? 'Аксессуар' : 'Зелье');
    const date = new Date().toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit'
    });
    return `${base} от ${date}`;
  }
}

module.exports = new TemplateService();