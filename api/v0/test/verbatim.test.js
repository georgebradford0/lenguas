// The model must never be the source of the original-language text we show: these
// pin down lib/verbatim.js, which rebuilds chunks and word entries from the sentence.
const { test } = require('node:test');
const assert = require('node:assert');
const { alignChunks, canonicalizeWords, cleanWord } = require('../lib/verbatim');

const S = 'denn dieses ist mit jenen, nicht bloß durch den erhabenen Posten eines Beschützers, sondern durch das viel vertrautere eines Liebhabers und erleuchteten Kenners, innigst verbunden.';
const ok = test;

// ---- alignChunks ----
ok('exact chunks pass through untouched', () => {
  const r = alignChunks(S, [
    { original: 'denn dieses ist mit jenen,', translation: 'a' },
    { original: 'nicht bloß durch den erhabenen Posten eines Beschützers,', translation: 'b' },
    { original: 'sondern durch das viel vertrautere eines Liebhabers und erleuchteten Kenners, innigst verbunden.', translation: 'c' },
  ]);
  assert.strictEqual(r.repaired, 0);
  assert.strictEqual(r.chunks.map(c => c.original).join(' '), S);
});

ok('"innigst" reworded to "inniglich" is repaired from the source', () => {
  const r = alignChunks(S, [
    { original: 'denn dieses ist mit jenen,', translation: 'a' },
    { original: 'nicht bloß durch den erhabenen Posten eines Beschützers,', translation: 'b' },
    { original: 'sondern durch das viel vertrautere eines Liebhabers und erleuchteten Kenners, inniglich verbunden.', translation: 'c' },
  ]);
  assert.strictEqual(r.repaired, 1);
  assert.ok(r.chunks[2].original.endsWith('innigst verbunden.'));
  assert.ok(!r.chunks.some(c => c.original.includes('inniglich')));
  assert.strictEqual(r.chunks.map(c => c.original).join(' '), S);
  assert.deepStrictEqual(r.chunks.map(c => c.translation), ['a', 'b', 'c']);
});

ok('every chunk is a literal substring of the source, even with odd whitespace', () => {
  const sent = 'Er kam   nach Hause\nund sie ging ins Bett.';
  const r = alignChunks(sent, [
    { original: 'Er kam nach Hause', translation: 'x' },
    { original: 'und sie ging ins Bett.', translation: 'y' },
  ]);
  for (const c of r.chunks) assert.ok(sent.includes(c.original), JSON.stringify(c.original));
  assert.strictEqual(r.chunks[0].original, 'Er kam   nach Hause');
});

ok('a dropped word is rejected (null), not papered over', () => {
  assert.strictEqual(alignChunks(S, [
    { original: 'denn dieses ist mit jenen,', translation: 'a' },
    { original: 'nicht bloß durch den Posten eines Beschützers,', translation: 'b' }, // "erhabenen" dropped
    { original: 'sondern durch das viel vertrautere eines Liebhabers und erleuchteten Kenners, innigst verbunden.', translation: 'c' },
  ]), null);
});

ok('an added/merged word is rejected (null)', () => {
  assert.strictEqual(alignChunks('Er kam nach Hause.', [
    { original: 'Er kam sofort nach Hause.', translation: 'x' },
  ]), null);
});

ok('same token count but different words is rejected (null)', () => {
  assert.strictEqual(alignChunks('Der Hund läuft schnell durch den Garten heute.', [
    { original: 'Die Katze schläft lange auf dem Sofa jetzt.', translation: 'x' },
  ]), null);
});

ok('empty / missing chunks are rejected (null)', () => {
  assert.strictEqual(alignChunks(S, []), null);
  assert.strictEqual(alignChunks(S, [{ original: '   ', translation: 'x' }]), null);
});

// ---- canonicalizeWords ----
const mk = (word, pos = 'noun') => ({ word, pos, translation: 't', explanation: null, usageInSentence: null, usageInGeneral: null });

ok('word entry "inniglich" is pointed back at the source token "innigst"', () => {
  const { words, repairs } = canonicalizeWords(S, [mk('Kenners'), mk('inniglich', 'adverb'), mk('verbunden', 'verb')]);
  assert.deepStrictEqual(words.map(w => w.word), ['Kenners', 'innigst', 'verbunden']);
  assert.deepStrictEqual(repairs, ['inniglich->innigst']);
});

ok('output word keys equal what the client computes from the displayed token', () => {
  const { words } = canonicalizeWords(S, [mk('verbunden', 'verb'), mk('Beschützers')]);
  const clientKeys = S.split(/\s+/).map(t => cleanWord(t).toLowerCase());
  for (const w of words) assert.ok(clientKeys.includes(w.word.toLowerCase()), w.word);
});

ok('case is taken from the source; hallucinated words are dropped; duplicates keep the first', () => {
  const { words, droppedWords } = canonicalizeWords('Der Hund sieht den Hund.', [mk('der', 'article'), mk('Hund'), mk('Katze'), mk('Hund'), mk('sieht', 'verb')]);
  assert.deepStrictEqual(words.map(w => w.word), ['Der', 'Hund', 'sieht']);
  assert.deepStrictEqual(droppedWords, ['Katze']);
});

ok('model-written fields other than "word" are preserved', () => {
  const { words } = canonicalizeWords('Der Hund läuft.', [{ word: 'läuft', pos: 'verb', translation: 'runs', explanation: 'e', usageInSentence: null, usageInGeneral: null }]);
  assert.deepStrictEqual(words[0], { word: 'läuft', pos: 'verb', translation: 'runs', explanation: 'e', usageInSentence: null, usageInGeneral: null });
});

ok('numbers are skipped silently, not reported as mismatches', () => {
  const { words, droppedWords } = canonicalizeWords('Königsberg den 29sten März 1781 Immanuel Kant', [mk('1781', 'number'), mk('Kant')]);
  assert.deepStrictEqual(words.map(w => w.word), ['Kant']);
  assert.deepStrictEqual(droppedWords, []);
});

