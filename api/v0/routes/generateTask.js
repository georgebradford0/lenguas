const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');
const Progress = require('../models/Progress');
const OpenAI = require('openai');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const { LANGUAGE_CONFIG } = require('../config/languages');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pollyClient = new PollyClient();


// Load vocabulary from JSON files
function loadVocabulary(level, language = 'de') {
  const langConfig = LANGUAGE_CONFIG[language];
  if (!langConfig) throw new Error(`Unsupported language: ${language}`);

  const filename = langConfig.levels[level];
  if (!filename) throw new Error(`No vocabulary found for level ${level} in language ${language}`);

  const filePath = path.join(__dirname, '..', 'wordlists', filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Vocabulary file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

// Weighted selection for spaced repetition
function selectWord(words, progressRecords) {
  const wordsWithWeights = words.map(w => {
    const progress = progressRecords[w.word] || { timesShown: 0, correctCount: 0 };
    // Lower weight = less likely to be selected
    // Higher timesShown and correctCount = lower weight
    const weight = 1 / (1 + progress.timesShown) / (1 + progress.correctCount);
    return { ...w, weight };
  });

  const totalWeight = wordsWithWeights.reduce((sum, w) => sum + w.weight, 0);
  let random = Math.random() * totalWeight;

  for (const word of wordsWithWeights) {
    random -= word.weight;
    if (random <= 0) {
      return word;
    }
  }

  return wordsWithWeights[0];
}

// Generate wrong answer choices that are similar but incorrect
function generateDistractors(targetWord, allWords, count = 3) {
  // Filter out the target word and shuffle
  const candidates = allWords
    .filter(w => w.word !== targetWord.word)
    .sort(() => Math.random() - 0.5);

  // Prefer words with same part of speech for better distractors
  const samePOS = candidates.filter(w => w.pos === targetWord.pos);
  const otherPOS = candidates.filter(w => w.pos !== targetWord.pos);

  // Take 2 from same POS and 1 from other POS if possible
  const distractors = [
    ...samePOS.slice(0, 2),
    ...otherPOS.slice(0, 1),
    ...candidates.slice(0, count), // fallback to any words
  ].slice(0, count);

  return distractors.map(w => w.full_entry);
}

/**
 * Parse German plural markers and generate plural form
 * Examples:
 *   "die Adresse, -en" → { singular: "die Adresse", plural: "die Adressen" }
 *   "der Apfel, -Ä" → { singular: "der Apfel", plural: "die Äpfel" }
 *   "das Auto, -s" → { singular: "das Auto", plural: "die Autos" }
 *   "der Ehemann, ä, er" → { singular: "der Ehemann", plural: "die Ehemänner" }
 *   "das Haus, -ü, er" → { singular: "das Haus", plural: "die Häuser" }
 */
function parsePluralForm(fullEntry) {
  // Match pattern: "article word, pluralMarker"
  const match = fullEntry.match(/^(der|die|das)\s+([^,]+),\s*(.+)$/i);

  if (!match) {
    // No plural marker found
    return { singular: fullEntry, plural: null };
  }

  const article = match[1];
  const word = match[2].trim();
  let pluralMarker = match[3].trim();

  // Handle cases like "ä, er" or "-ü, e" where umlaut and ending are separate
  // Normalize to "-äer" format
  pluralMarker = pluralMarker.replace(/^([-]?[äöüÄÖÜ]),?\s*/, '-$1');

  // All plurals use "die" as article
  let pluralForm = 'die ';
  let umlautedWord = word;

  // Check for umlaut markers
  const hasUmlautA = /[-]?[äÄ]/.test(pluralMarker);
  const hasUmlautO = /[-]?[öÖ]/.test(pluralMarker);
  const hasUmlautU = /[-]?[üÜ]/.test(pluralMarker);

  // Apply umlaut if present (case-insensitive replacement)
  if (hasUmlautA) {
    // Replace last 'a' or 'A' with corresponding umlaut, preserving case
    umlautedWord = word.replace(/a([^aA]*)$/i, (match, p1) => {
      const wasUpper = /A/.test(match.charAt(0));
      return (wasUpper ? 'Ä' : 'ä') + p1;
    });
    pluralMarker = pluralMarker.replace(/[-]?[äÄ]/, '');
  } else if (hasUmlautO) {
    umlautedWord = word.replace(/o([^oO]*)$/i, (match, p1) => {
      const wasUpper = /O/.test(match.charAt(0));
      return (wasUpper ? 'Ö' : 'ö') + p1;
    });
    pluralMarker = pluralMarker.replace(/[-]?[öÖ]/, '');
  } else if (hasUmlautU) {
    umlautedWord = word.replace(/u([^uU]*)$/i, (match, p1) => {
      const wasUpper = /U/.test(match.charAt(0));
      return (wasUpper ? 'Ü' : 'ü') + p1;
    });
    pluralMarker = pluralMarker.replace(/[-]?[üÜ]/, '');
  }

  // Clean up remaining marker (remove spaces, commas)
  pluralMarker = pluralMarker.replace(/^[,\s-]+/, '').trim();

  // Handle remaining ending markers
  if (!pluralMarker || pluralMarker === '–' || pluralMarker === '-') {
    // No ending change (just umlaut if applicable)
    pluralForm += umlautedWord;
  } else {
    // Special case: if word ends in 'e' and marker is 'en', only add 'n'
    if (umlautedWord.endsWith('e') && pluralMarker === 'en') {
      pluralForm += umlautedWord + 'n';
    } else {
      // Add the ending
      pluralForm += umlautedWord + pluralMarker;
    }
  }

  return {
    singular: `${article} ${word}`,
    plural: pluralForm
  };
}

/**
 * Format word for task - randomly choose singular or plural form for nouns
 * Returns object with display and audio text
 */
function formatWordForTask(fullEntry, pos, language = 'de') {
  // Only parse plurals for nouns in languages that support it
  if (pos !== 'noun' || !LANGUAGE_CONFIG[language]?.parsePlurals) {
    return { display: fullEntry, audio: fullEntry };
  }

  const { singular, plural } = parsePluralForm(fullEntry);

  // If plural exists, randomly choose singular or plural (50/50)
  if (plural && Math.random() < 0.5) {
    // Use plural form
    return { display: plural, audio: plural };
  }

  // Use singular form (default)
  return { display: singular, audio: singular };
}

// Translate a word to English using OpenAI.
// If language is provided and the word is a noun without an article, also
// looks up the correct article using language config.
// Returns { translation, article } — article is '' when not applicable.
async function translateWord(word, { needsArticle = false, language = 'de' } = {}) {
  try {
    const langConfig = LANGUAGE_CONFIG[language];
    const langName = langConfig?.name ?? language;
    let systemContent = `You are a translator. Translate the given ${langName} word or phrase to English. Give ONLY the English translation, nothing else. Keep it brief (1-5 words).`;
    if (needsArticle && langConfig?.articlePrompt) {
      systemContent += ' ' + langConfig.articlePrompt;
    }
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: word },
      ],
      temperature: 0.3,
      max_tokens: 20,
    });
    const text = response.choices[0].message.content.trim();
    if (needsArticle && langConfig?.normalizeArticle && text.includes('|')) {
      const [rawArticle, translation] = text.split('|').map(s => s.trim());
      const article = langConfig.normalizeArticle(rawArticle);
      return { translation, article };
    }
    return { translation: text, article: '' };
  } catch (error) {
    console.error('Translation error:', error);
    return { translation: word, article: '' };
  }
}

// Translate multiple words in parallel — returns array of translation strings
async function translateWords(words, language = 'de') {
  const results = await Promise.all(
    words.map(word => translateWord(word, { language }))
  );
  return results.map(r => r.translation);
}

// ── Pronunciation comparison: MFCC + DTW ────────────────────────────────────
const SAMPLE_RATE       = 16000;
const FRAME_SIZE        = 512;    // ~32 ms at 16 kHz, must be power-of-2
const HOP_SIZE          = 160;    // 10 ms at 16 kHz
const NUM_MEL           = 26;
const NUM_MFCC          = 13;
const FMIN              = 80;
const FMAX              = 7600;
const MAX_DTW_DIST      = 20;     // normalised DTW distance mapping to 0% similarity
const CORRECT_THRESHOLD = 0.60;   // ≥60% similarity → correct

let _melFilterbankCache = null;

function _hammingWindow(size) {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++)
    w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (size - 1));
  return w;
}

// In-place radix-2 Cooley-Tukey FFT (re, im: Float64Array, length = power-of-2)
function _fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
          t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang  = -2 * Math.PI / len;
    const wRe  = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0;
      for (let j = 0; j < half; j++) {
        const ur = re[i+j], ui = im[i+j];
        const vr = re[i+j+half] * cRe - im[i+j+half] * cIm;
        const vi = re[i+j+half] * cIm + im[i+j+half] * cRe;
        re[i+j]      = ur + vr;  im[i+j]      = ui + vi;
        re[i+j+half] = ur - vr;  im[i+j+half] = ui - vi;
        const tmp = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;  cRe = tmp;
      }
    }
  }
}

function _getMelFilterbank() {
  if (_melFilterbankCache) return _melFilterbankCache;
  const bins   = FRAME_SIZE / 2 + 1;
  const hzMel  = hz => 2595 * Math.log10(1 + hz / 700);
  const melHz  = m  => 700 * (10 ** (m / 2595) - 1);
  const mMin   = hzMel(FMIN), mMax = hzMel(FMAX);
  const melPts = Array.from({ length: NUM_MEL + 2 }, (_, i) =>
    mMin + (mMax - mMin) * i / (NUM_MEL + 1));
  const hzPts  = melPts.map(melHz);
  const binPts = hzPts.map(hz => Math.floor((FRAME_SIZE + 1) * hz / SAMPLE_RATE));
  const fb = [];
  for (let m = 1; m <= NUM_MEL; m++) {
    const f = new Float64Array(bins);
    for (let k = binPts[m-1]; k < binPts[m];   k++) if (k < bins) f[k] = (k - binPts[m-1]) / (binPts[m]   - binPts[m-1]);
    for (let k = binPts[m];   k <= binPts[m+1]; k++) if (k < bins) f[k] = (binPts[m+1] - k) / (binPts[m+1] - binPts[m]);
    fb.push(f);
  }
  _melFilterbankCache = fb;
  return fb;
}

// DCT-II: returns first numCoeffs coefficients
function _dct2(x, numCoeffs) {
  const n = x.length;
  return Array.from({ length: numCoeffs }, (_, k) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += x[i] * Math.cos(Math.PI * k * (2 * i + 1) / (2 * n));
    return s;
  });
}

// Cepstral mean & variance normalisation (per-utterance)
function _cmvn(frames) {
  if (!frames.length) return frames;
  const dim  = frames[0].length;
  const mean = new Float64Array(dim);
  const std  = new Float64Array(dim);
  for (const f of frames) for (let i = 0; i < dim; i++) mean[i] += f[i];
  for (let i = 0; i < dim; i++) mean[i] /= frames.length;
  for (const f of frames) for (let i = 0; i < dim; i++) std[i] += (f[i] - mean[i]) ** 2;
  for (let i = 0; i < dim; i++) std[i] = Math.sqrt(std[i] / frames.length + 1e-8);
  return frames.map(f => f.map((v, i) => (v - mean[i]) / std[i]));
}

// Extract MFCC matrix from raw Float32 PCM samples
function extractMFCCs(samples) {
  const hamming = _hammingWindow(FRAME_SIZE);
  const fb      = _getMelFilterbank();
  const fftBins = FRAME_SIZE / 2 + 1;
  const frames  = [];
  for (let start = 0; start + FRAME_SIZE <= samples.length; start += HOP_SIZE) {
    const re = new Float64Array(FRAME_SIZE);
    const im = new Float64Array(FRAME_SIZE);
    for (let i = 0; i < FRAME_SIZE; i++) re[i] = samples[start + i] * hamming[i];
    _fft(re, im);
    const power = new Float64Array(fftBins);
    for (let k = 0; k < fftBins; k++) power[k] = (re[k] ** 2 + im[k] ** 2) / FRAME_SIZE;
    const logMel = fb.map(filt => {
      let e = 0;
      for (let k = 0; k < fftBins; k++) e += filt[k] * power[k];
      return Math.log(Math.max(e, 1e-10));
    });
    // Skip C0 (average energy), keep C1–C13
    frames.push(_dct2(logMel, NUM_MFCC + 1).slice(1));
  }
  return _cmvn(frames);
}

function _euclidean(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// DTW: returns normalised distance (total accumulated cost / (n + m))
function _dtw(seq1, seq2) {
  const n = seq1.length, m = seq2.length;
  if (!n || !m) return Infinity;
  const dp = new Float64Array((n + 1) * (m + 1)).fill(1e9);
  dp[0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = _euclidean(seq1[i - 1], seq2[j - 1]);
      dp[i * (m + 1) + j] = cost + Math.min(
        dp[(i - 1) * (m + 1) + j],
        dp[i * (m + 1) + (j - 1)],
        dp[(i - 1) * (m + 1) + (j - 1)]
      );
    }
  }
  return dp[n * (m + 1) + m] / (n + m);
}

function dtwDistToSimilarity(dist) {
  return Math.max(0, Math.min(1, 1 - dist / MAX_DTW_DIST));
}

// Convert any audio file to 16 kHz mono float32 PCM, trimming leading/trailing silence
function convertToPcm(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-i', inputPath,
      '-af', 'silenceremove=start_periods=1:start_silence=0.05:start_threshold=-40dB:stop_periods=-1:stop_silence=0.05:stop_threshold=-40dB',
      '-ar', String(SAMPLE_RATE),
      '-ac', '1',
      '-f', 'f32le',
      '-y',
      outputPath,
    ], (err, _stdout, stderr) => {
      if (err) reject(new Error(`ffmpeg error: ${stderr.slice(-300)}`));
      else resolve();
    });
  });
}

/**
 * POST /generate-task
 * Generate a simple word translation task
 *
 * Body:
 * - level: string ('A1' | 'A2' | 'B1') - which level to use
 * - taskType: 'multipleChoice' | 'reverseTranslation' | 'audioMultipleChoice'
 *
 * Returns:
 * - task: object with German/English word and answer choices
 */
router.post('/generate-task', async (req, res) => {
  try {
    const { level = 'A1', taskType = 'multipleChoice', language = 'de' } = req.body;
    const userId = req.user.userId;

    // Validate inputs
    if (!LANGUAGE_CONFIG[language]) {
      return res.status(400).json({ error: `Invalid language. Must be one of: ${Object.keys(LANGUAGE_CONFIG).join(', ')}.` });
    }

    const availableLevels = Object.keys(LANGUAGE_CONFIG[language].levels);
    if (!availableLevels.includes(level)) {
      return res.status(400).json({ error: `Invalid level. Must be one of: ${availableLevels.join(', ')}.` });
    }

    if (!['multipleChoice', 'reverseTranslation', 'audioMultipleChoice', 'speechRecognition'].includes(taskType)) {
      return res.status(400).json({
        error: 'Invalid taskType. Must be "multipleChoice", "reverseTranslation", "audioMultipleChoice", or "speechRecognition".'
      });
    }

    // Load progress for all words in this language for this user
    const progressRecords = {};
    const allProgress = await Progress.find({ userId, language });
    allProgress.forEach(p => {
      progressRecords[p.word] = {
        timesShown: p.timesShown,
        correctCount: p.correctCount,
        blocked: p.blocked,
      };
    });

    // Load vocabulary for the level, excluding blocked words
    const vocabulary = loadVocabulary(level, language).filter(w => !progressRecords[w.word]?.blocked);

    // For speechRecognition, only select words the user has already answered correctly
    // a minimum number of times through other task types.
    const MIN_CORRECT_FOR_SPEECH = 3;
    const MIN_SPEECH_POOL_SIZE   = 100;
    let effectiveTaskType = taskType;
    let wordPool = vocabulary;

    if (taskType === 'speechRecognition') {
      const qualifiedWords = vocabulary.filter(w => {
        const prog = progressRecords[w.word];
        return prog && prog.correctCount >= MIN_CORRECT_FOR_SPEECH;
      });

      if (qualifiedWords.length >= MIN_SPEECH_POOL_SIZE) {
        wordPool = qualifiedWords;
      } else {
        effectiveTaskType = 'multipleChoice';
        console.log(`[generate-task] Only ${qualifiedWords.length} qualified words, need ${MIN_SPEECH_POOL_SIZE} for speechRecognition, falling back to multipleChoice`);
      }
    }

    // Select a word using weighted selection (spaced repetition)
    const targetWord = selectWord(wordPool, progressRecords);

    console.log(`Selected word: "${targetWord.word}" (${targetWord.pos}) for Level ${level} [taskType: ${effectiveTaskType}]`);

    // If the word has no article (e.g. Dutch nouns), look one up via OpenAI
    if (targetWord.pos === 'noun' && !targetWord.article) {
      const { article } = await translateWord(targetWord.word, { needsArticle: true, language });
      if (article) {
        targetWord.article = article;
        targetWord.full_entry = `${article} ${targetWord.full_entry}`;
      }
    }

    // Format word with plural (if noun)
    const targetFormatted = formatWordForTask(targetWord.full_entry, targetWord.pos, language);

    // Generate distractors (wrong answers)
    const distractors = generateDistractors(targetWord, vocabulary, 3);
    const distractorsFormatted = distractors.map((d, idx) => {
      // Get the original vocab entry to know its POS
      const distWord = vocabulary.find(v => v.full_entry === d);
      return distWord ? formatWordForTask(d, distWord.pos, language) : { display: d, audio: d };
    });

    // Translate to English (use audio version without plural notation)
    const { translation: correctEnglish } = await translateWord(targetFormatted.audio, { language });
    const wrongEnglishOptions = await translateWords(distractorsFormatted.map(d => d.audio), language);

    console.log(`Formatted: "${targetWord.full_entry}" → "${targetFormatted.display}"`);
    console.log(`Audio: "${targetFormatted.audio}"`);
    console.log(`Translated: "${targetFormatted.audio}" → "${correctEnglish}"`);

    // Build task based on type
    let taskData;

    if (effectiveTaskType === 'multipleChoice') {
      // Show target word, ask for English translation
      taskData = {
        target: targetFormatted.display,
        targetAudio: targetFormatted.audio,
        correctEnglish: correctEnglish,
        wrongOptions: wrongEnglishOptions,
      };
    } else if (effectiveTaskType === 'audioMultipleChoice') {
      // Audio only: play target audio, ask for English translation
      // Don't show the target text
      taskData = {
        targetAudio: targetFormatted.audio,
        correctEnglish: correctEnglish,
        wrongOptions: wrongEnglishOptions,
      };
    } else if (effectiveTaskType === 'speechRecognition') {
      // Speech recognition: show English, user speaks target language
      taskData = {
        english: correctEnglish,
        correctTarget: targetFormatted.audio,
        correctTargetAudio: targetFormatted.audio,
        pos: targetWord.pos,
      };
    } else {
      // Reverse: show English, ask for target language word
      // Use singular forms (audio versions) for cleaner choice display
      taskData = {
        english: correctEnglish,
        correctTarget: targetFormatted.audio, // Singular only for clean UI
        correctTargetAudio: targetFormatted.audio,
        wrongOptions: distractorsFormatted.map(d => d.audio), // Singular only
        wrongOptionsAudio: distractorsFormatted.map(d => d.audio),
      };
    }

    console.log(`Task generated successfully for word: ${targetWord.word}`);

    // Return the task with target word
    res.json({
      task: taskData,
      targetWord: targetWord.word,
      level,
      language,
      taskType: effectiveTaskType,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error generating task:', error);
    res.status(500).json({
      error: 'Failed to generate task',
      details: error.message
    });
  }
});

/**
 * POST /submit-answer
 * Submit answer and update progress tracking
 *
 * Body:
 * - targetWord: string - the word being tested
 * - level: string (A1/A2/B1)
 * - taskType: string
 * - userAnswer: string
 * - correctAnswer: string
 * - previousLevel: string (optional) - to detect level unlocks
 *
 * Returns:
 * - correct: boolean
 * - word: string
 * - stats: updated word statistics
 * - levelUnlocked: boolean (true if a level was just unlocked)
 * - newLevel: string (the newly unlocked level, if any)
 */
router.post('/submit-answer', async (req, res) => {
  try {
    const {
      targetWord,
      level,
      taskType,
      userAnswer,
      correctAnswer,
      previousLevel,
      language = 'de',
    } = req.body;
    const userId = req.user.userId;

    // Validate inputs (allow empty userAnswer for "give up" scenario)
    if (!targetWord || !level || !taskType || userAnswer === undefined || userAnswer === null || !correctAnswer) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if answer is correct (case-insensitive, trimmed)
    const isCorrect = userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();

    console.log(`Answer for "${targetWord}": ${isCorrect ? 'CORRECT' : 'WRONG'}`);
    console.log(`  User: "${userAnswer}", Correct: "${correctAnswer}"`);

    // Find or create progress for this user+word+language
    let progress = await Progress.findOne({ userId, word: targetWord, language });

    if (!progress) {
      progress = new Progress({
        userId,
        word: targetWord,
        language,
        level: level,
        timesShown: 0,
        correctCount: 0,
        lastSeenTaskType: null
      });
    }

    // Update progress
    progress.timesShown += 1;
    if (isCorrect) {
      progress.correctCount += 1;
    }
    progress.lastSeenTaskType = taskType;
    progress.level = level; // Update level in case it changed

    await progress.save();

    const accuracy = progress.timesShown > 0
      ? progress.correctCount / progress.timesShown
      : 0;

    console.log(`  Progress: ${progress.correctCount}/${progress.timesShown} (${Math.round(accuracy * 100)}%)`);

    // Check if this answer caused a level unlock
    let levelUnlocked = false;
    let newLevel = null;

    // Only check if we have a previousLevel to compare against
    if (previousLevel) {
      const currentLevel = await determineCurrentLevel(language, userId);

      // Level unlock detected
      if (currentLevel !== previousLevel) {
        levelUnlocked = true;
        newLevel = currentLevel;
        console.log(`🎉 Level ${newLevel} unlocked!`);
      }
    }

    // Return updated stats
    res.json({
      correct: isCorrect,
      word: targetWord,
      level,
      taskType,
      stats: {
        timesShown: progress.timesShown,
        correctCount: progress.correctCount,
        accuracy: Math.round(accuracy * 100)
      },
      levelUnlocked,
      newLevel,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error submitting answer:', error);
    res.status(500).json({
      error: 'Failed to submit answer',
      details: error.message
    });
  }
});

/**
 * Determine current level based on mastery.
 * The first level is always available; each subsequent level unlocks
 * when 100% of the previous level's words are mastered (7+ attempts, 75%+ accuracy).
 */
async function determineCurrentLevel(language = 'de', userId) {
  const levels = Object.keys(LANGUAGE_CONFIG[language].levels);
  const query = userId ? { userId, language } : { language };
  const allProgress = await Progress.find(query);
  const progressMap = {};
  allProgress.forEach(p => {
    progressMap[p.word] = p;
  });

  let currentLevel = levels[0];
  for (let i = 0; i < levels.length - 1; i++) {
    const vocab = loadVocabulary(levels[i], language);
    const mastered = vocab.filter(w => {
      const prog = progressMap[w.word];
      if (!prog) return false;
      const acc = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
      return prog.timesShown >= 7 && acc >= 0.75;
    }).length;

    if (mastered >= vocab.length) {
      currentLevel = levels[i + 1];
    } else {
      break;
    }
  }

  return currentLevel;
}

/**
 * GET /level-stats
 * Get level-based statistics from word progress
 *
 * Returns:
 * - currentLevel: string (A1/A2/B1)
 * - levelStats: array of level statistics with unlock status
 * - overallAccuracy: number
 * - totalWords: number
 */
router.get('/level-stats', async (req, res) => {
  try {
    const language = req.query.language || 'de';
    const userId = req.user.userId;

    if (!LANGUAGE_CONFIG[language]) {
      return res.status(400).json({ error: `Invalid language. Must be one of: ${Object.keys(LANGUAGE_CONFIG).join(', ')}.` });
    }

    // Load all progress for this user and language
    const allProgress = await Progress.find({ userId, language });

    const levels = Object.keys(LANGUAGE_CONFIG[language].levels);

    // Build progress map
    const progressMap = {};
    allProgress.forEach(p => { progressMap[p.word] = p; });

    const vocabs = levels.map(l =>
      loadVocabulary(l, language).filter(w => !progressMap[w.word]?.blocked)
    );

    // Calculate stats for each level
    const calculateLevelStats = (vocab, levelName) => {
      let totalAttempts = 0;
      let correctAttempts = 0;
      let masteredCount = 0;

      vocab.forEach(w => {
        const prog = progressMap[w.word];
        if (prog) {
          totalAttempts += prog.timesShown;
          correctAttempts += prog.correctCount;
          const accuracy = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
          if (prog.timesShown >= 7 && accuracy >= 0.75) masteredCount++;
        }
      });

      const accuracy = totalAttempts > 0 ? correctAttempts / totalAttempts : 0;
      return {
        level: levelName,
        total: vocab.length,
        mastered: masteredCount,
        percentage: Math.round((masteredCount / vocab.length) * 100),
        totalAttempts,
        accuracy: Math.round(accuracy * 100),
        unlocked: false,
      };
    };

    const levelStatsArray = vocabs.map((v, i) => calculateLevelStats(v, levels[i]));

    // Determine unlocking: first level always unlocked, each subsequent
    // unlocks when all unblocked words in the previous level are mastered
    levelStatsArray[0].unlocked = true;
    let currentLevel = levels[0];
    for (let i = 1; i < levels.length; i++) {
      const prevUnlocked = levelStatsArray[i - 1].unlocked;
      const prevFullyMastered = levelStatsArray[i - 1].mastered >= levelStatsArray[i - 1].total;
      levelStatsArray[i].unlocked = prevUnlocked && prevFullyMastered;
      if (levelStatsArray[i].unlocked) currentLevel = levels[i];
    }

    // Calculate overall stats
    const totalAttempts = allProgress.reduce((sum, p) => sum + p.timesShown, 0);
    const totalCorrect = allProgress.reduce((sum, p) => sum + p.correctCount, 0);
    const overallAccuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

    // Per-word progress for current level
    const currentLevelVocab = vocabs[levels.indexOf(currentLevel)];
    const wordProgress = currentLevelVocab.map(w => {
      const prog = progressMap[w.word];
      if (!prog) return { word: w.word, attempts: 0, accuracy: 0 };
      const accuracy = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
      return { word: w.word, attempts: prog.timesShown, accuracy: Math.round(accuracy * 100) };
    });

    const unlockLog = levelStatsArray.map(s => `${s.level} ${s.mastered}/${s.total}`).join(', ');
    console.log(`Level progression [${language}]: ${unlockLog}`);

    res.json({
      currentLevel,
      levelStats: levelStatsArray,
      overallAccuracy,
      totalWords: vocabs.reduce((sum, v) => sum + v.length, 0),
      totalAttempts,
      wordProgress,
    });

  } catch (error) {
    console.error('Error fetching level stats:', error);
    res.status(500).json({
      error: 'Failed to fetch level stats',
      details: error.message
    });
  }
});

// Legacy endpoint for backward compatibility
router.get('/tier-stats', async (req, res) => {
  try {
    const levelStats = await router.handle({ method: 'GET', url: '/level-stats' }, res);
    // Map level names to tier numbers for backward compatibility
    if (levelStats && levelStats.currentLevel) {
      const levelToTier = { 'A1': 1, 'A2': 2, 'B1': 3 };
      levelStats.currentTier = levelToTier[levelStats.currentLevel] || 1;
      levelStats.tierStats = levelStats.levelStats;
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * POST /block-word
 * Mark a word as blocked for this user — it will be excluded from task
 * generation and level-stats totals.
 */
router.post('/block-word', async (req, res) => {
  try {
    const { targetWord, level, language = 'de' } = req.body;
    const userId = req.user.userId;

    if (!targetWord || !level) {
      return res.status(400).json({ error: 'Missing targetWord or level' });
    }

    await Progress.findOneAndUpdate(
      { userId, word: targetWord, language },
      { $set: { blocked: true, level } },
      { upsert: true }
    );

    console.log(`[block-word] Blocked "${targetWord}" for user ${userId}`);
    res.json({ success: true, word: targetWord });
  } catch (error) {
    console.error('Error blocking word:', error);
    res.status(500).json({ error: 'Failed to block word' });
  }
});

// Normalise a word/phrase for comparison: lowercase, strip punctuation
function _normaliseForComparison(text) {
  return text
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '') // strip punctuation
    .trim();
}

// Levenshtein-based similarity in [0, 1]
function _stringSimilarity(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return 1 - dp[m][n] / Math.max(m, n);
}

/**
 * POST /compare-pronunciation
 * Transcribe the user's audio with Whisper, then compare the transcript to the
 * target word using normalised Levenshtein similarity.
 *
 * Body:
 *   audio:      string  – base64-encoded m4a recording
 *   targetWord: string  – the German word/phrase to compare against
 *   language:   string  – BCP-47 language code (default: 'de')
 *
 * Returns:
 *   similarity: number  – 0..1
 *   isCorrect:  boolean – similarity >= 0.75
 */
router.post('/compare-pronunciation', async (req, res) => {
  const tmpFiles = [];
  try {
    const { audio, targetWord, language = 'de', pos } = req.body;

    if (!audio || typeof audio !== 'string' || !targetWord) {
      return res.status(400).json({ error: 'Missing audio or targetWord' });
    }

    console.log('[Pronunciation] Transcribing for target:', targetWord, 'pos:', pos);

    const userM4a = path.join(os.tmpdir(), `user_${Date.now()}.m4a`);
    tmpFiles.push(userM4a);
    fs.writeFileSync(userM4a, Buffer.from(audio, 'base64'));

    // Transcribe with Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(userM4a),
      model: 'whisper-1',
      language,
      response_format: 'text',
    });

    const spoken = _normaliseForComparison((transcription || '').trim());
    const target = _normaliseForComparison(targetWord);

    console.log(`[Pronunciation] target="${target}" spoken="${spoken}"`);

    if (!spoken) {
      return res.json({ similarity: 0, isCorrect: false, articleMissing: false });
    }

    // For nouns, explicitly check the article is spoken (first word of target)
    let articleMissing = false;
    if (pos === 'noun') {
      const expectedArticle = target.split(/\s+/)[0];
      const spokenWords = spoken.split(/\s+/);
      articleMissing = !spokenWords.includes(expectedArticle);
      console.log(`[Pronunciation] noun article check: expected="${expectedArticle}" articleMissing=${articleMissing}`);
    }

    const similarity = _stringSimilarity(spoken, target);
    const isCorrect  = !articleMissing && similarity >= 0.75;

    console.log(`[Pronunciation] similarity=${(similarity * 100).toFixed(1)}% articleMissing=${articleMissing} isCorrect=${isCorrect}`);

    res.json({ similarity, isCorrect, articleMissing });

  } catch (err) {
    console.error('[Pronunciation] Error:', err.message);
    res.status(500).json({ error: 'Pronunciation comparison failed', details: err.message });
  } finally {
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch (_) {}
    }
  }
});

module.exports = router;
