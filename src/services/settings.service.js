const BotSettings = require('../db/models/BotSettings');

class SettingsService {
  async get() {
    let settings = await BotSettings.findById('global');
    if (!settings) {
      settings = await BotSettings.create({ _id: 'global' });
    }
    return settings;
  }

  async setPublishMode(mode, adminId) {
    const settings = await this.get();
    settings.publishMode = mode;
    settings.updatedAt = new Date();
    settings.updatedBy = adminId;
    await settings.save();
    return settings;
  }

  async setAutoVerify(enabled, adminId) {
    const settings = await this.get();
    settings.autoVerify = enabled;
    settings.updatedAt = new Date();
    settings.updatedBy = adminId;
    await settings.save();
    return settings;
  }

  async isAutoPublish() {
    const settings = await this.get();
    return settings.publishMode === 'auto';
  }
}

module.exports = new SettingsService();