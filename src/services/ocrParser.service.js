/**
 * Парсер OCR-результатов для извлечения характеристик лошади.
 */

const constants = require('../utils/constants');
const { similarity, findBestMatch } = require('../utils/fuzzy');
const logger = require('../utils/logger');

const SIZE_MAP = {
  'teacup': 'Teacup (чайная чашка)',
  'teeny': 'Teeny (крошечный)',
  'tiny': 'Tiny (крошечный)',
  'little': 'Little (маленький)',
  'small': 'Small (небольшой)',
  'normal': 'Normal (обычный)',
  'big': 'Big (большой)',
  'huge': 'Huge (огромный)',
  'giant': 'Giant (гигант)',
  'draft': 'Draft (проект/тяжеловоз)',
  'mammoth': 'Mammoth (мамонт)'
};

function isCleanWord(word) {
  if (!word || !word.text) return false;
  if (word.confidence < 40) return false;
  const text = word.text.trim();
  if (text.length < 2) return false;
  if (!/^[A-Za-z][A-Za-z\s\-']*$/.test(text)) return false;
  return true;
}

function findAnchor(words, anchorText, threshold = 0.6) {
  let best = null;
  let bestScore = 0;
  for (const word of words) {
    const score = similarity(word.text, anchorText);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      best = word;
    }
  }
  return best;
}

function extractValue(words, anchor) {
  // Попытка 1: справа на той же строке
  const rightCandidates = words.filter(w => {
    if (w === anchor) return false;
    if (!isCleanWord(w)) return false;
    const sameLine = Math.abs(w.bbox.y0 - anchor.bbox.y0) < 20;
    const toTheRight = w.bbox.x0 > anchor.bbox.x1 - 5;
    const notTooFar = (w.bbox.x0 - anchor.bbox.x1) < 150;
    return sameLine && toTheRight && notTooFar;
  });
  rightCandidates.sort((a, b) => a.bbox.x0 - b.bbox.x0);

  let result = '';
  let lastX = anchor.bbox.x1;
  for (const c of rightCandidates) {
    if (result && (c.bbox.x0 - lastX) > 80) break;
    result += (result ? ' ' : '') + c.text;
    lastX = c.bbox.x1;
    if (result.length > 40) break;
  }
  if (result.trim()) return result.trim();

  // Попытка 2: снизу
  const belowCandidates = words.filter(w => {
    if (w === anchor) return false;
    if (!isCleanWord(w)) return false;
    const isBelow = w.bbox.y0 > anchor.bbox.y1 - 5;
    const sameColumn = Math.abs(w.bbox.x0 - anchor.bbox.x0) < 60;
    const close = (w.bbox.y0 - anchor.bbox.y1) < 60;
    return isBelow && sameColumn && close;
  });
  belowCandidates.sort((a, b) => a.bbox.y0 - b.bbox.y0);

  result = '';
  let lastY = anchor.bbox.y1;
  for (const c of belowCandidates) {
    if (result && (c.bbox.y0 - lastY) > 40) break;
    result += (result ? ' ' : '') + c.text;
    lastY = c.bbox.y1;
    if (result.length > 40) break;
  }
  return result.trim() || null;
}

function parseHorseDataPhoto(words) {
  console.log('=== OCR: распознанные слова ===');
  if (words && words.length > 0) {
    console.log(words.map(w =>
      `"${w.text}" (conf:${Math.round(w.confidence)}) @ x=${Math.round(w.bbox.x0)},y=${Math.round(w.bbox.y0)}`
    ).join('\n'));
  } else {
    console.log('(нет распознанных слов)');
  }
  console.log('================================');

  const data = {};
  const missing = [];

  // SPECIES
  const speciesAnchor = findAnchor(words, 'SPECIES', 0.55);
  if (speciesAnchor) {
    const raw = extractValue(words, speciesAnchor);
    if (raw) {
      const match = findBestMatch(raw, constants.HORSE_SPECIES, 0.5);
      data.species = match ? match.value : raw;
    } else missing.push('SPECIES');
  } else missing.push('SPECIES');

  // GENDER
  const genderAnchor = findAnchor(words, 'GENDER', 0.6);
  if (genderAnchor) {
    const raw = extractValue(words, genderAnchor);
    if (raw) {
      const lower = raw.toLowerCase();
      if (lower.includes('male') && !lower.includes('female')) data.gender = 'мужской';
      else if (lower.includes('female')) data.gender = 'женский';
      else data.gender = raw;
    } else missing.push('GENDER');
  } else missing.push('GENDER');

  // SIZE
  const sizeAnchor = findAnchor(words, 'SIZE', 0.6);
  if (sizeAnchor) {
    const raw = extractValue(words, sizeAnchor);
    if (raw) {
      const lower = raw.toLowerCase().trim();
      let found = null;
      for (const [key, val] of Object.entries(SIZE_MAP)) {
        if (lower.includes(key)) { found = val; break; }
      }
      data.size = found || raw;
    } else missing.push('SIZE');
  } else missing.push('SIZE');

  // FERTILITY
  const infertileAnchor = findAnchor(words, 'INFERTILE', 0.8);
  data.fertility = infertileAnchor ? 'нет' : 'да';

  // ELDER — только если рядом есть Mutation/Passive
  const elderAnchors = words.filter(w => similarity(w.text, 'ELDER') > 0.85);
  let elderConfirmed = false;
  for (const elderAnchor of elderAnchors) {
    const nearbyMutation = words.find(w =>
      Math.abs(w.bbox.y0 - elderAnchor.bbox.y0) < 80 &&
      Math.abs(w.bbox.x0 - elderAnchor.bbox.x0) < 200 &&
      /mutation|passive/i.test(w.text)
    );
    if (nearbyMutation) { elderConfirmed = true; break; }
  }
  data.elder = elderConfirmed ? 'да' : 'нет';

  // MUTATIONS
  const mutations = parseBuffsMutations(words);
  data.mutations = mutations.length > 0 ? mutations.join(', ') : 'нет';

  return { data, missing };
}

function parseBuffsMutations(words) {
  const mutations = [];
  const KNOWN_MUTATIONS = constants.MUTATIONS || [];

  const mutationMarkers = words.filter(w => {
    if (w.confidence < 50) return false;
    const t = w.text.toLowerCase();
    return t === 'mutation' || similarity(w.text, 'Mutation') > 0.85;
  });

  for (const marker of mutationMarkers) {
    const candidates = words.filter(w => {
      if (w === marker) return false;
      if (!isCleanWord(w)) return false;
      const isAbove = w.bbox.y1 <= marker.bbox.y0 + 5;
      const sameColumn = Math.abs(w.bbox.x0 - marker.bbox.x0) < 80;
      const close = (marker.bbox.y0 - w.bbox.y1) < 50;
      return isAbove && sameColumn && close;
    });

    candidates.sort((a, b) => b.bbox.y1 - a.bbox.y1);

    let nameParts = [];
    for (const c of candidates) {
      nameParts.unshift(c.text);
      if (nameParts.length >= 3) break;
    }

    const name = nameParts.join(' ').trim();
    if (name && name.length > 2) {
      const match = findBestMatch(name, KNOWN_MUTATIONS, 0.6);
      mutations.push(match ? match.value : name);
    }
  }

  return [...new Set(mutations)];
}

function parseMutationSlots(words) {
  const header = findAnchor(words, 'MUTATIONS', 0.7);
  if (!header) return null;

  const slotPattern = /^(\d+)\s*\/\s*(\d+)$/;

  for (const word of words) {
    const match = word.text.match(slotPattern);
    if (match) {
      const sameLine = Math.abs(word.bbox.y0 - header.bbox.y0) < 40;
      const toTheRight = word.bbox.x0 > header.bbox.x1 - 5;
      if (sameLine && toTheRight) return `${match[1]}/${match[2]}`;
    }
  }

  for (const word of words) {
    if (word.text.includes('/')) {
      const parts = word.text.split('/').map(s => s.trim());
      if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
        const sameLine = Math.abs(word.bbox.y0 - header.bbox.y0) < 40;
        if (sameLine) return `${parts[0]}/${parts[1]}`;
      }
    }
  }

  return null;
}

module.exports = {
  parseHorseDataPhoto,
  parseMutationSlots,
  parseBuffsMutations
};