// Content-addressed S3 storage for parsed books.
// Books live at s3://$AWS_S3_BUCKET/parsed-books/<sha256>.json so re-uploads
// of the same EPUB are idempotent and skip the LLM cost.

const crypto = require('crypto');
const { S3Client, HeadObjectCommand, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const BUCKET = process.env.AWS_S3_BUCKET;
const PREFIX = 'parsed-books';
const INDEX_KEY = `${PREFIX}/_index.json`;
const REGION = process.env.AWS_REGION || 'us-west-2';

const s3 = new S3Client({ region: REGION });

function keyFor(hash) {
  return `${PREFIX}/${hash}.json`;
}

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function exists(hash) {
  if (!BUCKET) throw new Error('AWS_S3_BUCKET not set');
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: keyFor(hash) }));
    return true;
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NotFound') return false;
    throw err;
  }
}

async function get(hash) {
  if (!BUCKET) throw new Error('AWS_S3_BUCKET not set');
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: keyFor(hash) }));
  const chunks = [];
  for await (const chunk of res.Body) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function put(hash, book) {
  if (!BUCKET) throw new Error('AWS_S3_BUCKET not set');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: keyFor(hash),
    Body: JSON.stringify(book),
    ContentType: 'application/json',
  }));
}

// ── Library index ────────────────────────────────────────────────────────────
// A single JSON manifest at s3://bucket/parsed-books/_index.json lets the API
// serve the library list in one S3 GET instead of N HeadObject calls. The
// parse CLI is the only writer (the API never mutates it).

async function getIndex() {
  if (!BUCKET) throw new Error('AWS_S3_BUCKET not set');
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: INDEX_KEY }));
    const chunks = [];
    for await (const chunk of res.Body) chunks.push(chunk);
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return Array.isArray(parsed.books) ? parsed.books : [];
  } catch (err) {
    if (err.$metadata?.httpStatusCode === 404 || err.name === 'NoSuchKey') return [];
    throw err;
  }
}

async function putIndex(books) {
  if (!BUCKET) throw new Error('AWS_S3_BUCKET not set');
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: INDEX_KEY,
    Body: JSON.stringify({ books }, null, 2),
    ContentType: 'application/json',
  }));
}

module.exports = { hashBuffer, exists, get, put, getIndex, putIndex };
