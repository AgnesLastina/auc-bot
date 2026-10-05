require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const logger = require('../utils/logger');

// ============ GEMINI SETUP ============
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.6-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.6-pro'
];

// ============ NVIDIA NIM SETUP ============
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || null;
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

// VLM-модели (совместимы с /v1/chat/completions и image_url)
const NVIDIA_MODELS = [
  'nvidia/cosmos3-nano-reasoner',
  'meta/llama-3.2-90b-vision-instruct',
  'microsoft/phi-3.5-vision-instruct',
  'meta/llama-3.2-11b-vision-instruct'
];

// ============ PROXY ============
const PROXY_URL = process.env.PROXY_URL || null;

let axiosInstance = axios;
if (PROXY_URL) {
  try {
    const agent = new SocksProxyAgent(PROXY_URL);
    axiosInstance = axios.create({
      timeout: 60000,
      httpAgent: agent,
      httpsAgent: agent,
      proxy: false
    });
    console.log(`🌐 OCR axios using proxy: ${PROXY_URL.replace(/\/\/.*@/, '//***@')}`);
  } catch (e) {
    console.error('⚠️ Invalid PROXY_URL for axios:', e.message);
  }
} else {
  console.log('🌐 OCR axios without proxy');
}

// ============ DOWNLOAD ============
async function downloadImage(telegram, fileId) {
  const link = await telegram.getFileLink(fileId);
  console.log('OCR: downloading from', link.href.replace(/bot[^/]+/, 'bot***'));
  const response = await axiosInstance.get(link.href, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(response.data);
  console.log('OCR: downloaded', buffer.length, 'bytes');
  return buffer;
}

async function downloadImages(telegram, fileIds) {
  const buffers = [];
  for (const fileId of fileIds) {
    buffers.push(await downloadImage(telegram, fileId));
  }
  return buffers;
}

// ============ GEMINI CALL ============
async function tryGeminiModel(payload, modelName, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await gemini.models.generateContent({ ...payload, model: modelName });
    } catch (error) {
      lastError = error;
      const status = error?.status || error?.code || 0;
      if ((status === 503 || status === 429) && attempt < maxAttempts) {
        const delay = 2000 * attempt;
        logger.warn(`Gemini ${modelName} retry ${attempt}/${maxAttempts} after ${delay}ms (status ${status})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function callGeminiCascade(payload) {
  let lastError;
  for (const modelName of GEMINI_MODELS) {
    try {
      logger.info(`Gemini trying model: ${modelName}`);
      const response = await tryGeminiModel(payload, modelName, 3);
      logger.info(`Gemini success with model: ${modelName}`);
      return { provider: 'gemini', response };
    } catch (error) {
      const status = error?.status || error?.code || 0;
      logger.warn(`Gemini model ${modelName} failed (status ${status}): ${error.message}`);
      lastError = error;
      continue;
    }
  }
  throw lastError;
}

// ============ NVIDIA NIM CALL ============
async function tryNvidiaModel(messages, modelName, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axiosInstance.post(
        `${NVIDIA_BASE_URL}/chat/completions`,
        {
          model: modelName,
          messages: messages,
          max_tokens: 2048,
          temperature: 0.1,
          top_p: 0.9
        },
        {
          headers: {
            'Authorization': `Bearer ${NVIDIA_API_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          timeout: 60000
        }
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      lastError = error;
      const status = error?.response?.status || 0;
      const detail = error?.response?.data?.detail || error?.response?.data?.error?.message || error.message;
      if ((status === 429 || status === 503 || status === 500) && attempt < maxAttempts) {
        const delay = 2000 * attempt;
        logger.warn(`NVIDIA ${modelName} retry ${attempt}/${maxAttempts} after ${delay}ms (status ${status}: ${detail})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function callNvidiaCascade(messages) {
  let lastError;
  for (const modelName of NVIDIA_MODELS) {
    try {
      logger.info(`NVIDIA trying model: ${modelName}`);
      const text = await tryNvidiaModel(messages, modelName, 3);
      logger.info(`NVIDIA success with model: ${modelName}`);
      return { provider: 'nvidia', text };
    } catch (error) {
      const status = error?.response?.status || 0;
      const detail = error?.response?.data?.detail || error?.response?.data?.error?.message || error.message;
      logger.warn(`NVIDIA model ${modelName} failed (status ${status}): ${detail}`);
      lastError = error;
      continue;
    }
  }
  throw lastError;
}

// ============ BUILD MESSAGES FOR NVIDIA (OpenAI-compatible) ============
function buildNvidiaMessages(prompt, base64Images) {
  const content = [{ type: 'text', text: prompt }];

  for (const b64 of base64Images) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${b64}` }
    });
  }

  return [{ role: 'user', content }];
}

// ============ BUILD PAYLOAD FOR GEMINI ============
function buildGeminiPayload(prompt, base64Images) {
  const parts = [{ text: prompt }];
  for (const b64 of base64Images) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64 } });
  }
  return {
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', temperature: 0.1 }
  };
}

// ============ UNIVERSAL OCR ============
async function extractAllData(imageBuffers, category = 'horse') {
  const buffers = Array.isArray(imageBuffers) ? imageBuffers : [imageBuffers];
  const base64Images = buffers.map(b => b.toString('base64'));

  let prompt;

  if (category === 'horse') {
    prompt = `
Ты — OCR-парсер игрового интерфейса Horse Life.
На ${buffers.length} скриншоте(ах) — окна Info и/или Mutations лошади. Смотри ВСЕ фото вместе, ищи данные на любом из них.

Найди поля:
- SPECIES (вид лошади, например SERAPH, GARGOYLE)
- GENDER (пол: MALE или FEMALE)
- SIZE (размер: DRAFT, NORMAL, GIANT и т.д.)
- INFERTILE (если есть в BUFFS — фертильность = "нет", иначе "да")
- ELDER (если есть в BUFFS или AGE: ELDER — элдер = "да", иначе "нет")
- BUFFS — разбей на группы:
  * WINGS (крылья) — если в названии есть WING или WINGS
  * MUTATIONS (мутации) — всё остальное, где тип "Mutation"
- Счётчик мутаций N/N — в правом верхнем углу блока MUTATIONS (например 3/3, 0/4, 2/4)

Верни СТРОГО JSON без markdown:
{
  "species": "SERAPH",
  "gender": "MALE",
  "size": "DRAFT",
  "fertility": "да",
  "elder": "нет",
  "wings": "DIVINE WINGS",
  "mutations": ["GIGANTISM", "POWERFUL LUNGS"],
  "mutationSlots": "3/4"
}

Если поле не найдено на всех фото вместе — верни null или пустой массив.
Если счётчик слотов показан как N/N — верни ЧИСЛИТЕЛЬ и /4 (правило игры): "3/3" → "3/4", "0/1" → "0/4".
    `;
  } else if (category === 'accessory') {
    prompt = `
Ты — OCR-парсер игрового интерфейса Horse Life.
На ${buffers.length} скриншоте(ах) — информация об аксессуаре. Смотри ВСЕ фото вместе.

Найди поля:
- NAME (название аксессуара, например COWBOY HAT, WITCH HAT)
- TYPE (тип: Шляпа, Голова, Рот, Седло, Ноги, Хвост, Эффекты)
- THEME (тема, если указана: AMBER, GALAXY, SAKURA и т.д.)
- QUANTITY (количество, если видно)
- BUFFS / свойства (если есть)

Верни СТРОГО JSON без markdown:
{
  "name": "COWBOY HAT",
  "accessoryType": "Шляпа",
  "theme": "GALAXY",
  "quantity": 1
}

Если поле не найдено — верни null.
    `;
  } else {
    prompt = `
Ты — OCR-парсер игрового интерфейса Horse Life.
На ${buffers.length} скриншоте(ах) — информация о зелье. Смотри ВСЕ фото вместе.

Найди поля:
- NAME (название зелья, например MUTATION POTION, GROWTH POTION, ALIEN WING POTION)
- QUANTITY (количество, если видно)
- TYPE (категория, если видно: Разведение, Характеристики, Крылья, Мутации, Глаза)

Верни СТРОГО JSON без markdown:
{
  "name": "MUTATION POTION",
  "quantity": 1,
  "potionType": "Мутации"
}

Если поле не найдено — верни null.
    `;
  }

  let rawText = null;
  let provider = null;

  // 1. Пробуем Gemini
  try {
    const payload = buildGeminiPayload(prompt, base64Images);
    const result = await callGeminiCascade(payload);
    rawText = result.response.text;
    provider = 'gemini';
  } catch (geminiError) {
    logger.warn(`Gemini failed entirely: ${geminiError.message}`);

    // 2. Пробуем NVIDIA
    if (NVIDIA_API_KEY) {
      try {
        const messages = buildNvidiaMessages(prompt, base64Images);
        const result = await callNvidiaCascade(messages);
        rawText = result.text;
        provider = 'nvidia';
      } catch (nvidiaError) {
        logger.error(`NVIDIA failed entirely: ${nvidiaError.message}`);
        throw new Error('OCR_ERROR');
      }
    } else {
      logger.error('NVIDIA_API_KEY is not set in .env');
      throw new Error('OCR_ERROR');
    }
  }

  console.log(`=== OCR RAW (${provider}) ===`);
  console.log(rawText);
  console.log('===============');

  try {
    let clean = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const data = JSON.parse(clean);

    if (category === 'horse') {
      let wings = data.wings || null;
      let mutations = Array.isArray(data.mutations) ? data.mutations : [];
      const wingsFromMutations = mutations.filter(m => /wing/i.test(m));
      const cleanMutations = mutations.filter(m => !/wing/i.test(m));
      if (wingsFromMutations.length > 0) wings = wingsFromMutations.join(', ');

      let slots = data.mutationSlots || null;
      if (slots && typeof slots === 'string' && slots.includes('/')) {
        const numerator = slots.split('/')[0].trim();
        slots = `${numerator}/4`;
      }

      return {
        species: data.species || null,
        gender: data.gender === 'MALE' ? 'мужской' : data.gender === 'FEMALE' ? 'женский' : (data.gender || null),
        size: data.size || null,
        fertility: data.fertility || 'да',
        elder: data.elder || 'нет',
        wings: wings || 'нет',
        mutations: cleanMutations.length > 0 ? cleanMutations.join(', ') : 'нет',
        mutationSlots: slots
      };
    } else if (category === 'accessory') {
      return {
        name: data.name || null,
        accessoryType: data.accessoryType || null,
        theme: data.theme || null,
        quantity: data.quantity || null
      };
    } else {
      return {
        name: data.name || null,
        quantity: data.quantity || null,
        potionType: data.potionType || null
      };
    }
  } catch (parseError) {
    logger.error('OCR parse error:', parseError.message);
    console.error('Raw text that failed to parse:', rawText);
    throw new Error('OCR_ERROR');
  }
}

// Оставляем старые функции для совместимости
async function extractHorseData(imageBuffer) {
  return extractAllData([imageBuffer], 'horse');
}

async function extractMutationSlots(imageBuffer) {
  const data = await extractAllData([imageBuffer], 'horse');
  return { mutationSlots: data.mutationSlots };
}

module.exports = {
  extractAllData,
  extractHorseData,
  extractMutationSlots,
  downloadImage,
  downloadImages
};