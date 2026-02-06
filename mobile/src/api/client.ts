import type { TranslationResult, ProgressRecord } from '../types';

// For iOS Simulator: Use your Mac's local IP (not localhost)
// To find your IP: ipconfig getifaddr en0
// For Docker: Make sure container exposes port with -p 3000:3000
const API_BASE = 'http://localhost:3000';

export async function loadWords(): Promise<string[]> {
  const response = await fetch(`${API_BASE}/words`);
  if (!response.ok) {
    throw new Error('Failed to load words');
  }
  return response.json();
}

export async function translate(word: string): Promise<TranslationResult> {
  const response = await fetch(`${API_BASE}/translate/${encodeURIComponent(word)}`);
  if (!response.ok) {
    throw new Error('Failed to translate word');
  }
  return response.json();
}

export async function speak(text: string): Promise<string> {
  const response = await fetch(`${API_BASE}/speak/${encodeURIComponent(text)}`);
  if (!response.ok) {
    throw new Error('Failed to get speech');
  }
  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function loadProgress(): Promise<Record<string, { timesShown: number; correctCount: number }>> {
  const response = await fetch(`${API_BASE}/progress`);
  if (!response.ok) {
    throw new Error('Failed to load progress');
  }
  const records: ProgressRecord[] = await response.json();
  const progress: Record<string, { timesShown: number; correctCount: number }> = {};
  for (const r of records) {
    progress[r.word] = {
      timesShown: r.timesShown,
      correctCount: r.correctCount,
    };
  }
  return progress;
}

export async function saveProgress(
  word: string,
  data: { timesShown: number; correctCount: number }
): Promise<void> {
  await fetch(`${API_BASE}/progress/${encodeURIComponent(word)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
}
