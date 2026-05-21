import { Platform } from 'react-native';
import { fromByteArray } from 'base64-js';

const DEV_API_BASE = Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
const API_BASE = __DEV__ ? DEV_API_BASE : 'https://lenguas.directto.link';
console.log('[DEBUG client] API_BASE', { API_BASE, dev: __DEV__, platform: Platform.OS });

// Auth token holder — set after login
let _authToken: string | null = null;

export function setAuthToken(token: string | null) {
  _authToken = token;
}

function authHeaders(): Record<string, string> {
  return _authToken ? { Authorization: `Bearer ${_authToken}` } : {};
}

export async function loginRequest(email: string): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to send login code');
  }
}

export async function verifyCode(email: string, code: string): Promise<{ token: string; userId: string }> {
  const response = await fetch(`${API_BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Invalid or expired code');
  }
  return response.json();
}

export async function speak(text: string, language = 'de'): Promise<string> {
  const response = await fetch(`${API_BASE}/speak/${encodeURIComponent(text)}?language=${language}`, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error('Failed to get speech');
  }
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  return fromByteArray(bytes);
}

export async function deleteAccount(): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/account`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to delete account');
  }
}

export interface SentenceWord {
  word: string;
  pos: 'noun' | 'verb';
  translation: string;
  explanation: string | null;
}

export interface SentenceTranslation {
  translation: string;
  words: SentenceWord[];
}

export async function translateSentence(
  sentence: string,
  language: string,
): Promise<SentenceTranslation> {
  const url = `${API_BASE}/translate/sentence`;
  console.log('[DEBUG translateSentence] request', { url, sentence, language, hasAuthToken: !!_authToken });
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ sentence, language }),
    });
  } catch (err: any) {
    console.log('[DEBUG translateSentence] network error', { url, error: err?.message });
    throw err;
  }
  console.log(`[DEBUG translateSentence] response status=${response.status} ok=${response.ok}`);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.log(`[DEBUG translateSentence] NON-OK status=${response.status} body=${body}`);
    throw new Error(`Sentence translation failed: ${response.status}`);
  }
  return response.json();
}

import type { SerializedBook } from '../utils/epubParser';

export interface BookParseProgress {
  phase: 'extract' | 'toc' | 'toc-done' | 'section';
  message?: string;
  current?: number;
  total?: number;
  sectionId?: string;
  title?: string;
  toc?: Array<{ id: string; title: string; level: number }>;
}

/**
 * Upload an EPUB (as base64) and stream the multi-step LLM parse back.
 * Returns the final book once /translate/book has assembled all sections.
 *
 * Progress events stream over a chunked HTTP response (one JSON object per line).
 * We use XMLHttpRequest because React Native's fetch doesn't expose ReadableStream
 * reliably across iOS/Android.
 */
export function parseBookWithLLM(
  epubBase64: string,
  language: string,
  title: string | null,
  onProgress: (p: BookParseProgress) => void,
): Promise<SerializedBook> {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}/translate/book`;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    if (_authToken) xhr.setRequestHeader('Authorization', `Bearer ${_authToken}`);
    xhr.timeout = 0; // no timeout; parsing can take many minutes

    let cursor = 0;
    let book: SerializedBook | null = null;
    let errorMessage: string | null = null;

    function processChunks() {
      const text = xhr.responseText;
      if (text.length <= cursor) return;
      const lastNewline = text.lastIndexOf('\n');
      if (lastNewline < cursor) return;
      const complete = text.slice(cursor, lastNewline);
      cursor = lastNewline + 1;
      for (const line of complete.split('\n')) {
        if (!line.trim()) continue;
        let msg: any;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'progress') {
          onProgress(msg as BookParseProgress);
        } else if (msg.type === 'book') {
          book = msg.data as SerializedBook;
        } else if (msg.type === 'error') {
          errorMessage = String(msg.message || 'Book parsing failed');
        }
      }
    }

    xhr.onprogress = processChunks;
    xhr.onload = () => {
      processChunks();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText.slice(0, 200)}`));
        return;
      }
      if (errorMessage) reject(new Error(errorMessage));
      else if (book) resolve(book);
      else reject(new Error('Book parse stream ended without a book payload'));
    };
    xhr.onerror = () => reject(new Error('Network error during book parse'));
    xhr.ontimeout = () => reject(new Error('Book parse timed out'));

    xhr.send(JSON.stringify({ epubBase64, language, title }));
  });
}
