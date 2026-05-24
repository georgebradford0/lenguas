import { Platform } from 'react-native';
import { fromByteArray } from 'base64-js';

const DEV_API_BASE = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
const API_BASE = __DEV__ ? DEV_API_BASE : 'https://lenguas.directto.link';

export async function speak(text: string, language = 'de'): Promise<string> {
  const response = await fetch(`${API_BASE}/speak/${encodeURIComponent(text)}?language=${language}`);
  if (!response.ok) {
    throw new Error('Failed to get speech');
  }
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  return fromByteArray(bytes);
}

export interface SentenceWord {
  word: string;
  pos: 'noun' | 'verb';
  translation: string;
  explanation: string | null;
}

export interface SentenceChunk {
  original: string;
  translation: string;
}

export interface SentenceTranslation {
  translation: string;
  chunks: SentenceChunk[];
  words: SentenceWord[];
}

export async function translateSentence(
  sentence: string,
  language: string,
): Promise<SentenceTranslation> {
  const url = `${API_BASE}/translate/sentence`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentence, language }),
    });
  } catch (err: any) {
    throw err;
  }
  if (!response.ok) {
    throw new Error(`Sentence translation failed: ${response.status}`);
  }
  return response.json();
}

import type { SerializedBook, CefrLevel } from '../utils/epubParser';

// ── Library ──────────────────────────────────────────────────────────────────
// The server library is read-only. Parsing happens offline via the CLI script
// (api/v0/bin/parse-epub.js), which uploads to S3. Mobile lists summaries and
// downloads full books on demand, caching them locally by contentHash.

export interface LibrarySummary {
  contentHash: string;
  title: string;
  author: string | null;
  description: string | null;
  genre: string | null;
  difficulty: CefrLevel | null;
  language: string;
  uploadedAt: number;
}

export async function listLibrary(language?: string): Promise<LibrarySummary[]> {
  const qs = language ? `?language=${encodeURIComponent(language)}` : '';
  const res = await fetch(`${API_BASE}/books${qs}`);
  if (!res.ok) throw new Error(`Failed to list library: HTTP ${res.status}`);
  const json = await res.json();
  return Array.isArray(json.books) ? json.books : [];
}

export async function fetchBook(contentHash: string): Promise<SerializedBook> {
  const res = await fetch(`${API_BASE}/books/${contentHash}`);
  if (!res.ok) throw new Error(`Failed to fetch book: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.book) throw new Error('Server response missing `book` field');
  return json.book as SerializedBook;
}
