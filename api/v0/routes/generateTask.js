const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');
const Progress = require('../models/Progress');
const OpenAI = require('openai');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pollyClient = new PollyClient();

// Load vocabulary from JSON files
function loadVocabulary(level) {
  const levelFiles = {
    'A1': path.join(__dirname, '..', 'wordlists', 'a1_vocabulary.json'),
    'A2': path.join(__dirname, '..', 'wordlists', 'a2_vocabulary.json'),
    'B1': path.join(__dirname, '..', 'wordlists', 'b1_vocabulary.json'),
  };

  const filePath = levelFiles[level];
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error(`No vocabulary found for level ${level}`);
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
function formatWordForTask(fullEntry, pos) {
  // Only parse plurals for nouns
  if (pos !== 'noun') {
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

// Translate German word to English using OpenAI
async function translateWord(germanWord) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a German-English translator. Translate the given German word or phrase to English. Give ONLY the English translation, nothing else. Keep it brief (1-5 words).',
        },
        { role: 'user', content: germanWord },
      ],
      temperature: 0.3,
      max_tokens: 20,
    });
    return response.choices[0].message.content.trim();
  } catch (error) {
    console.error('Translation error:', error);
    return germanWord; // Fallback to German if translation fails
  }
}

// Translate multiple words in parallel
async function translateWords(germanWords) {
  const translations = await Promise.all(
    germanWords.map(word => translateWord(word))
  );
  return translations;
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
    const { level = 'A1', taskType = 'multipleChoice', userId = 'default' } = req.body;

    // Validate inputs
    if (!['A1', 'A2', 'B1'].includes(level)) {
      return res.status(400).json({ error: 'Invalid level. Must be A1, A2, or B1.' });
    }

    if (!['multipleChoice', 'reverseTranslation', 'audioMultipleChoice', 'speechRecognition'].includes(taskType)) {
      return res.status(400).json({
        error: 'Invalid taskType. Must be "multipleChoice", "reverseTranslation", "audioMultipleChoice", or "speechRecognition".'
      });
    }

    // Load vocabulary for the level
    const vocabulary = loadVocabulary(level);

    // Load progress for all words
    const progressRecords = {};
    const allProgress = await Progress.find({});
    allProgress.forEach(p => {
      progressRecords[p.word] = {
        timesShown: p.timesShown,
        correctCount: p.correctCount
      };
    });

    // For speechRecognition, only select words the user has already answered correctly
    // a minimum number of times through other task types.
    const MIN_CORRECT_FOR_SPEECH = 3;
    let effectiveTaskType = taskType;
    let wordPool = vocabulary;

    if (taskType === 'speechRecognition') {
      const qualifiedWords = vocabulary.filter(w => {
        const prog = progressRecords[w.word];
        return prog && prog.correctCount >= MIN_CORRECT_FOR_SPEECH;
      });

      if (qualifiedWords.length > 0) {
        wordPool = qualifiedWords;
      } else {
        effectiveTaskType = 'multipleChoice';
        console.log('[generate-task] No words qualify for speechRecognition yet, falling back to multipleChoice');
      }
    }

    // Select a word using weighted selection (spaced repetition)
    const targetWord = selectWord(wordPool, progressRecords);

    console.log(`Selected word: "${targetWord.word}" (${targetWord.pos}) for Level ${level} [taskType: ${effectiveTaskType}]`);

    // Format German word with plural (if noun)
    const targetFormatted = formatWordForTask(targetWord.full_entry, targetWord.pos);

    // Generate distractors (wrong answers) - these are German words/phrases
    const distractors = generateDistractors(targetWord, vocabulary, 3);
    const distractorsFormatted = distractors.map((d, idx) => {
      // Get the original vocab entry to know its POS
      const distWord = vocabulary.find(v => v.full_entry === d);
      return distWord ? formatWordForTask(d, distWord.pos) : { display: d, audio: d };
    });

    // Translate to English (use audio version without plural notation)
    const correctEnglish = await translateWord(targetFormatted.audio);
    const wrongEnglishOptions = await translateWords(distractorsFormatted.map(d => d.audio));

    console.log(`Formatted: "${targetWord.full_entry}" → "${targetFormatted.display}"`);
    console.log(`Audio: "${targetFormatted.audio}"`);
    console.log(`Translated: "${targetFormatted.audio}" → "${correctEnglish}"`);

    // Build task based on type
    let taskData;

    if (effectiveTaskType === 'multipleChoice') {
      // Show German word, ask for English translation
      taskData = {
        german: targetFormatted.display,
        germanAudio: targetFormatted.audio,
        correctEnglish: correctEnglish,
        wrongOptions: wrongEnglishOptions,
      };
    } else if (effectiveTaskType === 'audioMultipleChoice') {
      // Audio only: play German audio, ask for English translation
      // Don't show the German text
      taskData = {
        germanAudio: targetFormatted.audio,
        correctEnglish: correctEnglish,
        wrongOptions: wrongEnglishOptions,
      };
    } else if (effectiveTaskType === 'speechRecognition') {
      // Speech recognition: show English, user speaks German
      taskData = {
        english: correctEnglish,
        correctGerman: targetFormatted.audio,
        correctGermanAudio: targetFormatted.audio,
      };
    } else {
      // Reverse: show English, ask for German
      // Use singular forms (audio versions) for cleaner choice display
      taskData = {
        english: correctEnglish,
        correctGerman: targetFormatted.audio, // Singular only for clean UI
        correctGermanAudio: targetFormatted.audio,
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
      previousLevel
    } = req.body;

    // Validate inputs (allow empty userAnswer for "give up" scenario)
    if (!targetWord || !level || !taskType || userAnswer === undefined || userAnswer === null || !correctAnswer) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if answer is correct (case-insensitive, trimmed)
    const isCorrect = userAnswer.trim().toLowerCase() === correctAnswer.trim().toLowerCase();

    console.log(`Answer for "${targetWord}": ${isCorrect ? 'CORRECT' : 'WRONG'}`);
    console.log(`  User: "${userAnswer}", Correct: "${correctAnswer}"`);

    // Find or create progress for this word
    let progress = await Progress.findOne({ word: targetWord });

    if (!progress) {
      progress = new Progress({
        word: targetWord,
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
      const currentLevel = await determineCurrentLevel();

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
 * Determine current level based on mastery
 * A1 is always available
 * A2 unlocks when 100% of A1 words are mastered (7+ attempts, 75%+ accuracy)
 * B1 unlocks when 100% of A2 words are mastered
 */
async function determineCurrentLevel() {
  const allProgress = await Progress.find({});
  const progressMap = {};
  allProgress.forEach(p => {
    progressMap[p.word] = p;
  });

  // Load vocabularies
  const a1Vocab = loadVocabulary('A1');
  const a2Vocab = loadVocabulary('A2');

  // Calculate A1 mastery
  let a1Mastered = 0;
  a1Vocab.forEach(w => {
    const prog = progressMap[w.word];
    if (prog) {
      const acc = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
      if (prog.timesShown >= 7 && acc >= 0.75) {
        a1Mastered++;
      }
    }
  });

  const a2Unlocked = a1Mastered >= a1Vocab.length; // 100% mastery required

  if (!a2Unlocked) {
    return 'A1';
  }

  // Calculate A2 mastery
  let a2Mastered = 0;
  a2Vocab.forEach(w => {
    const prog = progressMap[w.word];
    if (prog) {
      const acc = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
      if (prog.timesShown >= 7 && acc >= 0.75) {
        a2Mastered++;
      }
    }
  });

  const b1Unlocked = a2Mastered >= a2Vocab.length; // 100% mastery required

  return b1Unlocked ? 'B1' : 'A2';
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
    // Load all progress
    const allProgress = await Progress.find({});

    // Load vocabularies
    const a1Vocab = loadVocabulary('A1');
    const a2Vocab = loadVocabulary('A2');
    const b1Vocab = loadVocabulary('B1');

    // Calculate stats for each level
    const calculateLevelStats = (vocab, levelName) => {
      const progressMap = {};
      allProgress.forEach(p => {
        progressMap[p.word] = p;
      });

      let totalAttempts = 0;
      let correctAttempts = 0;
      let masteredCount = 0;

      vocab.forEach(w => {
        const prog = progressMap[w.word];
        if (prog) {
          totalAttempts += prog.timesShown;
          correctAttempts += prog.correctCount;

          // Mastery criteria: 7+ attempts AND 75%+ accuracy
          const accuracy = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
          if (prog.timesShown >= 7 && accuracy >= 0.75) {
            masteredCount++;
          }
        }
      });

      const accuracy = totalAttempts > 0 ? correctAttempts / totalAttempts : 0;
      const masteryPercentage = Math.round((masteredCount / vocab.length) * 100);

      return {
        level: levelName,
        total: vocab.length,
        mastered: masteredCount,
        percentage: masteryPercentage,
        totalAttempts,
        accuracy: Math.round(accuracy * 100),
        unlocked: false, // Will be set below
      };
    };

    const a1Stats = calculateLevelStats(a1Vocab, 'A1');
    const a2Stats = calculateLevelStats(a2Vocab, 'A2');
    const b1Stats = calculateLevelStats(b1Vocab, 'B1');

    // Determine level unlocking
    // A1 is always unlocked
    a1Stats.unlocked = true;

    // A2 unlocks when 100% of A1 words are mastered
    const a2Unlocked = a1Stats.mastered >= a1Vocab.length;
    a2Stats.unlocked = a2Unlocked;

    // B1 unlocks when 100% of A2 words are mastered
    const b1Unlocked = a2Unlocked && a2Stats.mastered >= a2Vocab.length;
    b1Stats.unlocked = b1Unlocked;

    // Current level is the highest unlocked level
    let currentLevel = 'A1';
    if (b1Unlocked) currentLevel = 'B1';
    else if (a2Unlocked) currentLevel = 'A2';

    const levelStatsArray = [a1Stats, a2Stats, b1Stats];

    // Calculate overall stats
    const totalAttempts = allProgress.reduce((sum, p) => sum + p.timesShown, 0);
    const totalCorrect = allProgress.reduce((sum, p) => sum + p.correctCount, 0);
    const overallAccuracy = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

    // Get per-word progress for current level
    const currentLevelVocab = currentLevel === 'A1' ? a1Vocab : currentLevel === 'A2' ? a2Vocab : b1Vocab;
    const progressMap = {};
    allProgress.forEach(p => {
      progressMap[p.word] = p;
    });

    const wordProgress = currentLevelVocab.map(w => {
      const prog = progressMap[w.word];
      if (!prog) {
        return { word: w.word, attempts: 0, accuracy: 0 };
      }
      const accuracy = prog.timesShown > 0 ? prog.correctCount / prog.timesShown : 0;
      return {
        word: w.word,
        attempts: prog.timesShown,
        accuracy: Math.round(accuracy * 100)
      };
    });

    console.log(`Level progression: A1 ${a1Stats.mastered}/${a1Vocab.length}, A2 ${a2Unlocked ? 'UNLOCKED' : 'locked'}, B1 ${b1Unlocked ? 'UNLOCKED' : 'locked'}`);

    res.json({
      currentLevel,
      levelStats: levelStatsArray,
      overallAccuracy,
      totalWords: a1Vocab.length + a2Vocab.length + b1Vocab.length,
      totalAttempts,
      wordProgress // Per-word progress for current level
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
 * POST /compare-pronunciation
 * Compare user's spoken German against a Polly TTS reference using MFCC + DTW.
 *
 * Body:
 *   audio:      string  – base64-encoded m4a recording
 *   targetWord: string  – the German word/phrase to compare against
 *
 * Returns:
 *   similarity: number  – 0..1
 *   isCorrect:  boolean – similarity >= CORRECT_THRESHOLD
 */
router.post('/compare-pronunciation', async (req, res) => {
  const tmpFiles = [];
  try {
    const { audio, targetWord } = req.body;

    if (!audio || typeof audio !== 'string' || !targetWord) {
      return res.status(400).json({ error: 'Missing audio or targetWord' });
    }

    console.log('[Pronunciation] Comparing pronunciation for:', targetWord);

    const id      = Date.now();
    const tmpDir  = os.tmpdir();
    const userM4a = path.join(tmpDir, `user_${id}.m4a`);
    const userPcm = path.join(tmpDir, `user_${id}.f32`);
    const refMp3  = path.join(tmpDir, `ref_${id}.mp3`);
    const refPcm  = path.join(tmpDir, `ref_${id}.f32`);
    tmpFiles.push(userM4a, userPcm, refMp3, refPcm);

    // 1. Write user audio to disk
    fs.writeFileSync(userM4a, Buffer.from(audio, 'base64'));

    // 2. Get Polly TTS reference for the target word (same Hans voice as the app)
    const pollyResp = await pollyClient.send(new SynthesizeSpeechCommand({
      Text:         targetWord,
      OutputFormat: 'mp3',
      VoiceId:      'Hans',
      LanguageCode: 'de-DE',
    }));
    const refBytes = await pollyResp.AudioStream.transformToByteArray();
    fs.writeFileSync(refMp3, Buffer.from(refBytes));

    // 3. Convert both to 16 kHz mono float32 PCM with leading/trailing silence trimmed
    await Promise.all([
      convertToPcm(userM4a, userPcm),
      convertToPcm(refMp3,  refPcm),
    ]);

    // 4. Read PCM buffers
    const userBuf = fs.readFileSync(userPcm);
    const refBuf  = fs.readFileSync(refPcm);

    if (userBuf.length < FRAME_SIZE * 4) {
      console.warn('[Pronunciation] User audio too short after silence removal');
      return res.json({ similarity: 0, isCorrect: false });
    }

    const userSamples = new Float32Array(userBuf.buffer.slice(userBuf.byteOffset, userBuf.byteOffset + userBuf.byteLength));
    const refSamples  = new Float32Array(refBuf.buffer.slice(refBuf.byteOffset,   refBuf.byteOffset  + refBuf.byteLength));

    // 5. Extract MFCC matrices
    const userMFCCs = extractMFCCs(userSamples);
    const refMFCCs  = extractMFCCs(refSamples);

    if (!userMFCCs.length || !refMFCCs.length) {
      return res.json({ similarity: 0, isCorrect: false });
    }

    // 6. DTW comparison → similarity score
    const dist       = _dtw(userMFCCs, refMFCCs);
    const similarity = dtwDistToSimilarity(dist);
    const isCorrect  = similarity >= CORRECT_THRESHOLD;

    console.log(`[Pronunciation] "${targetWord}" DTW=${dist.toFixed(2)} similarity=${(similarity * 100).toFixed(1)}% isCorrect=${isCorrect}`);

    res.json({ similarity, isCorrect });

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
