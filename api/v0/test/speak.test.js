// /speak routes Latin to the tts sidecar and leaves every other language on Polly.
// The sidecar is a stubbed global fetch, so no network or Polly credentials needed.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const router = require('../routes/speak');

const app = express();
app.use('/speak', router);

const realFetch = global.fetch;
let upstream, sidecarCalls;
let server, port;

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  port = server.address().port;
  global.fetch = async (url, init) => {
    if (String(url).startsWith(`http://localhost:${port}`)) return realFetch(url, init);
    sidecarCalls.push({ url: String(url), init });
    return upstream();
  };
});
after(() => { global.fetch = realFetch; server.close(); });

const get = (path) => fetch(`http://localhost:${port}${path}`);

test('Latin is proxied to the sidecar and the mp3 bytes come back', async () => {
  sidecarCalls = [];
  upstream = async () => new Response(Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]), { status: 200 });
  const res = await get(`/speak/${encodeURIComponent('Deus est.')}?language=la`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('content-type'), 'audio/mpeg');
  assert.deepStrictEqual([...Buffer.from(await res.arrayBuffer())], [0x49, 0x44, 0x33, 1, 2, 3]);
  assert.strictEqual(sidecarCalls.length, 1);
  assert.ok(sidecarCalls[0].url.endsWith('/synthesize'));
  assert.deepStrictEqual(JSON.parse(sidecarCalls[0].init.body), { text: 'Deus est.', language: 'la' });
});

test('client errors from the sidecar pass through; server errors become 502', async () => {
  sidecarCalls = [];
  upstream = async () => new Response('nothing speakable', { status: 422 });
  assert.strictEqual((await get('/speak/...?language=la')).status, 422);
  upstream = async () => new Response('boom', { status: 500 });
  assert.strictEqual((await get('/speak/x?language=la')).status, 502);
});

test('an unreachable sidecar is a 500 with a message, not a crash', async () => {
  sidecarCalls = [];
  upstream = async () => { throw new Error('connect ECONNREFUSED'); };
  const res = await get('/speak/x?language=la');
  assert.strictEqual(res.status, 500);
  assert.ok((await res.json()).error.includes('ECONNREFUSED'));
});
