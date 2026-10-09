// Enforces that "original-language" text sent to the client is the user's
// sentence, never the model's rewrite of it. LLMs "helpfully" correct archaic
// spellings (innigst -> inniglich), so a verbatim instruction in the prompt is
// not enough: the sentence is the ground truth, and everything we return as
// source text is sliced from it.

// Same edge-stripping as the mobile client's cleanWord (utils/epubParser.ts),
// so word keys computed here match the keys the reader looks taps up by.
const EDGE_NON_LETTERS = /^[^a-zA-ZÀ-ɏЀ-ӿ]+|[^a-zA-ZÀ-ɏЀ-ӿ]+$/g;

function cleanWord(text) {
  return text.replace(EDGE_NON_LETTERS, '').trim();
}

function normKey(text) {
  return cleanWord(text).toLowerCase();
}

/** Whitespace-separated tokens with their character offsets in `text`. */
function tokenize(text) {
  const tokens = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function commonPrefixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Plausibly the same word with a spelling/inflection change (innigst/inniglich, Haus/Hauses). */
function isSameWord(a, b) {
  if (!a || !b) return false;
  const maxLen = Math.max(a.length, b.length);
  const minLen = Math.min(a.length, b.length);
  if (levenshtein(a, b) <= Math.max(2, Math.floor(0.4 * maxLen))) return true;
  return commonPrefixLength(a, b) >= Math.max(4, Math.ceil(0.6 * minLen));
}

/**
 * Rebuild the model's chunks from the source sentence.
 *
 * The model's chunking is only trusted for *where the boundaries fall* (how many
 * tokens go in each chunk). The text of every chunk is sliced from `sentence`, so
 * a reworded token in the model's output is repaired, and the chunks always
 * concatenate back to the sentence exactly.
 *
 * Returns { chunks, repaired } or null when the model's output can't be mapped
 * onto the sentence (tokens dropped/added/merged, or mostly different words).
 */
function alignChunks(sentence, modelChunks) {
  const src = tokenize(sentence);
  const groups = modelChunks.map(c => tokenize(c.original));
  if (groups.length === 0 || groups.some(g => g.length === 0)) return null;
  const total = groups.reduce((n, g) => n + g.length, 0);
  if (total !== src.length) return null;

  let p = 0;
  let repaired = 0;
  let far = 0;
  const chunks = groups.map((group, i) => {
    for (let k = 0; k < group.length; k++) {
      const a = normKey(group[k].text);
      const b = normKey(src[p + k].text);
      if (a !== b) {
        repaired++;
        if (!isSameWord(a, b)) far++;
      }
    }
    const chunk = {
      original: sentence.slice(src[p].start, src[p + group.length - 1].end),
      translation: modelChunks[i].translation,
    };
    p += group.length;
    return chunk;
  });

  // Counting tokens is only a safe way to repair if the model's text is
  // recognisably this sentence; otherwise the boundaries are meaningless.
  if (far > Math.max(1, Math.floor(src.length * 0.15))) return null;
  return { chunks, repaired };
}

/**
 * Point every word entry at a real token of the sentence.
 *
 * The reader looks word taps up by the cleaned, lower-cased token text, so an
 * entry whose `word` was reworded by the model would silently never match. Each
 * entry is matched to a source token (exact first, then closest plausible
 * spelling) and `word` is rewritten to that token's own text. Entries that match
 * nothing in the sentence are dropped; duplicates keep the first occurrence.
 */
function canonicalizeWords(sentence, modelWords) {
  const src = tokenize(sentence);
  const keys = src.map(t => normKey(t.text));
  const used = new Array(src.length).fill(false);
  const seen = new Set();
  const words = [];
  const repairs = [];
  const droppedWords = [];
  let cursor = 0;

  const findExact = (target, from, to) => {
    for (let i = from; i < to; i++) {
      if (!used[i] && keys[i] === target) return i;
    }
    return -1;
  };

  for (const w of modelWords) {
    const target = normKey(w.word);
    // Digits/punctuation clean to "" and are non-tappable in the reader, so an
    // entry for one could never be looked up; skip it without flagging a mismatch.
    if (!target) continue;

    let idx = findExact(target, cursor, src.length);
    if (idx === -1) idx = findExact(target, 0, cursor);

    if (idx === -1) {
      let bestDist = Infinity;
      let bestGap = Infinity;
      for (let i = 0; i < src.length; i++) {
        if (used[i] || !isSameWord(target, keys[i])) continue;
        const dist = levenshtein(target, keys[i]);
        const gap = Math.abs(i - cursor);
        if (dist < bestDist || (dist === bestDist && gap < bestGap)) {
          idx = i;
          bestDist = dist;
          bestGap = gap;
        }
      }
    }

    if (idx === -1) { droppedWords.push(w.word); continue; }

    used[idx] = true;
    cursor = idx + 1;
    const surface = cleanWord(src[idx].text);
    const key = surface.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (key !== target) repairs.push(`${w.word}->${surface}`);
    words.push({ ...w, word: surface });
  }

  return { words, repairs, droppedWords };
}

module.exports = { tokenize, cleanWord, normKey, alignChunks, canonicalizeWords };
