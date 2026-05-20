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

export async function parseChapterText(
  rawLines: string[],
  language: string,
): Promise<string[][]> {
  const response = await fetch(`${API_BASE}/translate/chapter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ rawLines, language }),
  });
  if (!response.ok) throw new Error(`Chapter parsing failed: ${response.status}`);
  const { paragraphs } = await response.json();
  return paragraphs as string[][];
}
