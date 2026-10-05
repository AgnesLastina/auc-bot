/**
 * Fuzzy-сопоставление строк (Jaro-Winkler).
 */

function similarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions) / matches) / 3;
  const prefixLength = Math.min(4, commonPrefixLength(s1, s2));
  const jaroWinkler = jaro + prefixLength * 0.1 * (1 - jaro);

  return Math.min(1, Math.max(0, jaroWinkler));
}

function commonPrefixLength(s1, s2) {
  let length = 0;
  const max = Math.min(s1.length, s2.length);
  for (let i = 0; i < max; i++) {
    if (s1[i] !== s2[i]) break;
    length++;
  }
  return length;
}

function findBestMatch(query, candidates, threshold = 0.7) {
  if (!query || !candidates || candidates.length === 0) return null;
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = similarity(query, candidate);
    if (score > bestScore && score >= threshold) {
      bestScore = score;
      best = candidate;
    }
  }
  return best ? { value: best, score: bestScore } : null;
}

module.exports = { similarity, findBestMatch };