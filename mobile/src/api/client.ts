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

// Remote API server on AWS EC2
const API_BASE = 'http://35.88.113.219:3000';

export async function loadWords(): Promise<WordData[]> {
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

export async function speak(text: string, language = 'de'): Promise<string> {
  const response = await fetch(`${API_BASE}/speak/${encodeURIComponent(text)}?language=${language}`);
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

export async function loadProgress(): Promise<Record<string, ProgressRecord>> {
  const response = await fetch(`${API_BASE}/progress`);
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
    headers: {
      'Content-Type': 'application/json',
    },
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
    headers: {
      'Content-Type': 'application/json',
    },
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
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error('Failed to submit answer');
  }

  return response.json();
}

// Get level-based stats (new)
export async function getLevelStats(language = 'de'): Promise<LevelStatsResponse> {
  const response = await fetch(`${API_BASE}/level-stats?language=${language}`);

  if (!response.ok) {
    throw new Error('Failed to load level stats');
  }

  return response.json();
}

// Legacy tier stats (for backward compatibility)
export async function getTierStats(): Promise<TierStatsResponse> {
  const response = await fetch(`${API_BASE}/tier-stats`);

  if (!response.ok) {
    throw new Error('Failed to load tier stats');
  }

  return response.json();
}

// Compare user's pronunciation against Polly TTS reference using MFCC + DTW
export async function comparePronunciation(
  audioBase64: string,
  targetWord: string,
  language = 'de',
): Promise<{ similarity: number; isCorrect: boolean }> {
  const response = await fetch(`${API_BASE}/compare-pronunciation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audio: audioBase64, targetWord, language }),
  });

  if (!response.ok) {
    throw new Error('Pronunciation comparison failed');
  }

  return response.json();
}
