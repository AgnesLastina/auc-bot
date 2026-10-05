const axios = require('axios');
const fs = require('fs');

class SmartParser {
  constructor(rulesFile = './parser-rules.json') {
    this.rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
    this.baseUrl = `${this.rules.wikiUrl}/api.php`;
  }

  async getWikitext(pageTitle) {
    try {
      const response = await axios.get(this.baseUrl, {
        params: { action: 'parse', page: pageTitle, prop: 'wikitext', format: 'json' },
        headers: { 'User-Agent': 'HorseAuctionBot/1.0' },
        timeout: 10000
      });
      return response.data?.parse?.wikitext?.['*'] || '';
    } catch (e) { return ''; }
  }

  async getCategory(categoryName) {
    try {
      const response = await axios.get(this.baseUrl, {
        params: { action: 'query', list: 'categorymembers', cmtitle: `Category:${categoryName}`, cmlimit: 500, format: 'json' },
        headers: { 'User-Agent': 'HorseAuctionBot/1.0' },
        timeout: 15000
      });
      return (response.data?.query?.categorymembers || []).map(p => p.title);
    } catch (e) { return []; }
  }

  cleanName(name, pageConfig) {
    const clean = this.rules.cleaning;
    let result = name;
    for (const prefix of clean.removePrefixes) {
      if (result.startsWith(prefix)) result = result.substring(prefix.length);
    }
    for (const suffix of clean.removeSuffixes) {
      result = result.replace(new RegExp(`${suffix}$`, 'i'), '').trim();
    }
    for (const ext of clean.removeExtensions) {
      result = result.replace(new RegExp(`\\${ext}$`, 'i'), '');
    }
    if (clean.replaceUnderscores) result = result.replace(/_/g, ' ');
    result = result.replace(/\s+/g, ' ').trim();
    return (result && result.length >= clean.minLength) ? result : null;
  }

  async parseCategory(pageConfig) {
    const rawNames = await this.getCategory(pageConfig.categoryName);
    let names = rawNames.map(n => this.cleanName(n, pageConfig)).filter(n => n !== null);
    if (pageConfig.excludePatterns) {
      for (const pattern of pageConfig.excludePatterns) {
        names = names.filter(n => !n.startsWith(pattern));
      }
    }
    return [...new Set(names)].sort();
  }

  async parseWikitext(pageConfig) {
    const wikitext = await this.getWikitext(pageConfig.title);
    const regex = new RegExp(pageConfig.pattern, 'g');
    const names = [];
    let match;
    while ((match = regex.exec(wikitext)) !== null) {
      const name = match[pageConfig.group || 1].trim();
      const cleanName = this.cleanName(name, pageConfig);
      if (cleanName && (!pageConfig.filter || cleanName.includes(pageConfig.filter))) {
        names.push(cleanName);
      }
    }
    return [...new Set(names)].sort();
  }

  async parseAll() {
    const results = {};
    console.log('🤖 УМНЫЙ ПАРСЕР (правила из parser-rules.json)\n');
    for (const [key, config] of Object.entries(this.rules.pages)) {
      console.log(`📄 ${key}: ${config.title} (${config.method})`);
      let names;
      if (config.method === 'category') {
        names = await this.parseCategory(config);
      } else {
        names = await this.parseWikitext(config);
      }
      results[key] = names;
      console.log(`   ✅ Найдено: ${names.length} шт.`);
      if (names.length > 0) {
        names.slice(0, 3).forEach(n => console.log(`      - ${n}`));
        if (names.length > 3) console.log(`      ... и ещё ${names.length - 3}`);
      }
    }
    return results;
  }
}

module.exports = new SmartParser();
