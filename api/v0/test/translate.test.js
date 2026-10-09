// Exercises POST /translate/sentence end to end against a scripted fake model, so
// the verbatim guarantees (repair, retry, whole-sentence fallback) are tested
// without network access or an API key.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// Fake model: each call pops the next scripted answer.
let script = [], calls = 0, lastSystem = '';
class FakeOpenAI { constructor() { this.chat = { completions: { create: async (req) => {
  calls++; lastSystem = req.messages[0].content;
  const next = script.shift();
  if (!next) throw new Error('script exhausted');
  return { choices: [{ message: { content: JSON.stringify(next) } }] };
} } }; } }
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'openai' ? FakeOpenAI : origLoad.call(this, request, ...rest); };

const express = require('express');
const router = require('../routes/translate');
const app = express(); app.use(express.json()); app.use('/translate', router);

const S = 'Wen das Leben vergnügt, dem ist der Beifall innigst willkommen.';
const word = (w, pos = 'noun') => ({ word: w, pos, translation: 't', explanation: null, usageInSentence: null, usageInGeneral: null });
const good = {
  translation: 'whole',
  chunks: [{ original: 'Wen das Leben vergnügt,', translation: 'a' }, { original: 'dem ist der Beifall innigst willkommen.', translation: 'b' }],
  words: [word('Leben'), word('innigst', 'adverb')],
};
const post = async (port) => (await fetch(`http://localhost:${port}/translate/sentence`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sentence: S, language: 'de' }) })).json();

let server, port;
before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  port = server.address().port;
});
after(() => server.close());

const run = async (answers) => {
  script = answers.slice();
  calls = 0;
  return post(port);
};

test('model rewrites "innigst" -> "inniglich" in chunk AND word: output uses the source, 1 model call', async () => {
  const out = await run([{
    ...good,
    chunks: [good.chunks[0], { original: 'dem ist der Beifall inniglich willkommen.', translation: 'b' }],
    words: [word('Leben'), word('inniglich', 'adverb')],
  }]);
  assert.strictEqual(calls, 1);
  assert.strictEqual(out.chunks[1].original, 'dem ist der Beifall innigst willkommen.');
  assert.deepStrictEqual(out.words.map(w => w.word), ['Leben', 'innigst']);
  assert.ok(!JSON.stringify(out).includes('inniglich'));
});

test('model drops a word, then gets it right on retry: retried once, retry note sent', async () => {
  const out = await run([
    { ...good, chunks: [good.chunks[0], { original: 'dem ist Beifall innigst willkommen.', translation: 'b' }] },
    good,
  ]);
  assert.strictEqual(calls, 2);
  assert.ok(lastSystem.includes('did not reproduce the sentence word-for-word'));
  assert.strictEqual(out.chunks.map(c => c.original).join(' '), S);
});

test('model fails twice: falls back to ONE whole-sentence chunk equal to the source', async () => {
  const out = await run([
    { ...good, chunks: [{ original: 'Wen das Leben vergnügt,', translation: 'a' }, { original: 'dem ist Beifall innigst willkommen.', translation: 'b' }] },
    { ...good, chunks: [{ original: 'Wen das vergnügt,', translation: 'a' }, { original: 'dem ist der Beifall innigst willkommen.', translation: 'b' }] },
  ]);
  assert.strictEqual(calls, 2);
  assert.deepStrictEqual(out.chunks, [{ original: S, translation: 'whole' }]);
});

test('model returns no chunks: retried, then falls back', async () => {
  const out = await run([{ ...good, chunks: [] }, { ...good, chunks: [] }]);
  assert.strictEqual(calls, 2);
  assert.strictEqual(out.chunks[0].original, S);
});

test('clean answer passes through with one call and unchanged chunks', async () => {
  const out = await run([good]);
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(out.chunks.map(c => c.original), good.chunks.map(c => c.original));
});

test('hallucinated word entry is dropped, real ones kept', async () => {
  const out = await run([{ ...good, words: [word('Leben'), word('Katze'), word('Beifall')] }]);
  assert.deepStrictEqual(out.words.map(w => w.word), ['Leben', 'Beifall']);
});
