const axios = require('axios');

const BASE_URL = 'https://horse-life-wiki-roblox.fandom.com/api.php';
const HEADERS = { 'User-Agent': 'HorseAuctionBot/1.0 (Test)' };

async function getPageSource(pageTitle) {
  try {
    const response = await axios.get(BASE_URL, {
      params: { action: 'parse', page: pageTitle, prop: 'wikitext', format: 'json' },
      headers: HEADERS, timeout: 10000
    });
    return response.data?.parse?.wikitext?.['*'] || '';
  } catch (e) { return ''; }
}

async function getCategoryPages(categoryName) {
  try {
    const response = await axios.get(BASE_URL, {
      params: { action: 'query', list: 'categorymembers', cmtitle: `Category:${categoryName}`, cmlimit: 500, format: 'json' },
      headers: HEADERS, timeout: 15000
    });
    return (response.data?.query?.categorymembers || []).map(p => p.title);
  } catch (e) { return []; }
}

function cleanName(raw) {
  let name = raw
    .replace(/^File:/i, '')
    .replace(/Showcase\.(png|jpg|jpeg|gif|webp)$/i, '')
    .replace(/Flair Showcase\.(png|jpg|jpeg|gif|webp)$/i, '')
    .replace(/Flair\.(png|jpg|jpeg|gif|webp)$/i, '')
    .replace(/\.(png|jpg|jpeg|gif|webp)$/i, '')
    .replace(/Showcase$/i, '').replace(/Flair$/i, '')
    .replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return (name && name.length >= 2) ? name : null;
}

function parsePotions(wikitext) {
  const names = [];
  const regex = /<span id="([^"]+)">([^<]+)<\/span>/g;
  let match;
  while ((match = regex.exec(wikitext)) !== null) {
    const name = match[2].trim();
    if (name && name.includes('Potion')) names.push(name);
  }
  return [...new Set(names)].sort();
}

async function main() {
  console.log('🐴 ТЕСТ ПАРСЕРА WIKI FANDOM\n');
  console.log('⏳ Загрузка данных...\n');

  const allItems = {
    hats: [],
    head: [],
    mouth: [],
    saddle: [],
    legs: [],
    tail: [],
    flair: [],
    potions: [],
    horses: []
  };

  // Аксессуары
  const categories = ['Hat', 'Head', 'Mouth', 'Saddle', 'Leg', 'Tail', 'Flair'];
  for (const cat of categories) {
    const rawNames = await getCategoryPages(cat);
    const names = rawNames.map(cleanName).filter(n => n !== null);
    const key = cat.toLowerCase();
    allItems[key] = names;
    console.log(`✅ ${cat}: ${names.length} шт.`);
    names.slice(0, 5).forEach(n => console.log(`   - ${n}`));
    if (names.length > 5) console.log(`   ... и ещё ${names.length - 5}`);
  }

  // Зелья
  const potionsWT = await getPageSource('Potions');
  allItems.potions = parsePotions(potionsWT);
  console.log(`✅ Зелья: ${allItems.potions.length} шт.`);
  allItems.potions.slice(0, 5).forEach(n => console.log(`   - ${n}`));
  if (allItems.potions.length > 5) console.log(`   ... и ещё ${allItems.potions.length - 5}`);

  // Лошади
  const speciesNames = await getCategoryPages('Species');
  allItems.horses = speciesNames
    .filter(n => !n.startsWith('File:') && !n.startsWith('Template:') && !n.startsWith('Category:'))
    .map(cleanName).filter(n => n !== null);
  console.log(`✅ Лошади: ${allItems.horses.length} шт.`);
  allItems.horses.slice(0, 10).forEach(n => console.log(`   - ${n}`));
  if (allItems.horses.length > 10) console.log(`   ... и ещё ${allItems.horses.length - 10}`);

  // ИТОГ
  let total = 0;
  for (const v of Object.values(allItems)) total += v.length;
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`📦 ВСЕГО НАЗВАНИЙ: ${total}`);
  console.log(`${'='.repeat(50)}\n`);

  // Вывод всех названий по категориям
  console.log('📋 ПОЛНЫЕ СПИСКИ:\n');
  for (const [cat, names] of Object.entries(allItems)) {
    console.log(`${'='.repeat(50)}`);
    console.log(`${cat.toUpperCase()} (${names.length} шт.)`);
    console.log(`${'='.repeat(50)}`);
    names.forEach((n, i) => console.log(`  ${(i+1).toString().padStart(4)}. ${n}`));
    console.log();
  }
}

main().catch(console.error);