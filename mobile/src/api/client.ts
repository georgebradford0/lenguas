import { fromByteArray } from 'base64-js';
import type {
  TranslationResult,
  ProgressRecord,
  WordData,
  GenerateTaskResponse,
  SubmitAnswerRequest,
  SubmitAnswerResponse,
  TierStatsResponse,
  LevelStatsResponse,
  TaskType,
} from '../types';

const API_BASE = 'https://lenguas.directto.link';

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

export async function loadWords(): Promise<WordData[]> {
  const response = await fetch(`${API_BASE}/words`, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error('Failed to load words');
  }
  return response.json();
}

export async function translate(word: string): Promise<TranslationResult> {
  const response = await fetch(`${API_BASE}/translate/${encodeURIComponent(word)}`, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error('Failed to translate word');
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

export async function loadProgress(): Promise<Record<string, ProgressRecord>> {
  const response = await fetch(`${API_BASE}/progress`, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error('Failed to load progress');
  }
  const records: ProgressRecord[] = await response.json();
  const progress: Record<string, ProgressRecord> = {};
  for (const r of records) {
    progress[r.word] = {
      word: r.word,
      timesShown: r.timesShown,
      correctCount: r.correctCount,
      tier: r.tier,
      lastSeenTaskType: r.lastSeenTaskType,
    };
  }
  return progress;
}

export async function saveProgress(
  word: string,
  data: { timesShown: number; correctCount: number; tier?: number; lastSeenTaskType?: string }
): Promise<void> {
  await fetch(`${API_BASE}/progress/${encodeURIComponent(word)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(data),
  });
}

// New level-based task generation API

export async function generateTask(
  level: string, // A1, A2, or B1
  taskType: TaskType,
  language = 'de',
): Promise<GenerateTaskResponse> {
  const response = await fetch(`${API_BASE}/generate-task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ level, taskType, language }),
  });

  if (!response.ok) {
    throw new Error('Failed to generate task');
  }

  return response.json();
}

export async function submitAnswer(
  request: SubmitAnswerRequest
): Promise<SubmitAnswerResponse> {
  const response = await fetch(`${API_BASE}/submit-answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error('Failed to submit answer');
  }

  return response.json();
}

// Get level-based stats (new)
export async function getLevelStats(language = 'de'): Promise<LevelStatsResponse> {
  const response = await fetch(`${API_BASE}/level-stats?language=${language}`, { headers: authHeaders() });

  if (!response.ok) {
    throw new Error('Failed to load level stats');
  }

  return response.json();
}

// Legacy tier stats (for backward compatibility)
export async function getTierStats(): Promise<TierStatsResponse> {
  const response = await fetch(`${API_BASE}/tier-stats`, { headers: authHeaders() });

  if (!response.ok) {
    throw new Error('Failed to load tier stats');
  }

  return response.json();
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

// Compare user's pronunciation against Polly TTS reference using MFCC + DTW
export async function comparePronunciation(
  audioBase64: string,
  targetWord: string,
  language = 'de',
  pos?: string,
): Promise<{ similarity: number; isCorrect: boolean; articleMissing?: boolean; recognizedText?: string }> {
  const response = await fetch(`${API_BASE}/compare-pronunciation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ audio: audioBase64, targetWord, language, pos }),
  });

  if (!response.ok) {
    throw new Error('Pronunciation comparison failed');
  }

  return response.json();
}

export async function translateWord(
  word: string,
  sentence: string,
  language: string,
): Promise<{ translation: string; explanation: string | null }> {
  const response = await fetch(`${API_BASE}/translate/word`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ word, sentence, language }),
  });
  if (!response.ok) throw new Error(`Word translation failed: ${response.status}`);
  return response.json();
}

export async function translatePhrase(text: string, language: string): Promise<string> {
  const response = await fetch(`${API_BASE}/translate/phrase`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ text, language }),
  });
  if (!response.ok) throw new Error(`Translation failed: ${response.status}`);
  const { translation } = await response.json();
  return translation as string;
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

export async function blockWord(targetWord: string, level: string, language: string): Promise<void> {
  const response = await fetch(`${API_BASE}/block-word`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ targetWord, level, language }),
  });
  if (!response.ok) throw new Error('Failed to block word');
}
