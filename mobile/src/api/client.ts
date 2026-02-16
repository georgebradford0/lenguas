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
  focusArea?: string
): Promise<GenerateTaskResponse> {
  const response = await fetch(`${API_BASE}/generate-task`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      level,
      taskType,
      focusArea: focusArea || 'general',
    }),
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
export async function getLevelStats(): Promise<LevelStatsResponse> {
  const response = await fetch(`${API_BASE}/level-stats`);

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

// Transcribe speech to text using OpenAI Whisper API
export async function transcribeSpeech(
  audioBase64: string,
  correctAnswer?: string
): Promise<{ transcription: string; match?: boolean; similarity?: number }> {
  const response = await fetch(`${API_BASE}/transcribe-speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio: audioBase64,
      correctAnswer,
    }),
  });

  if (!response.ok) {
    throw new Error('Transcription failed');
  }

  const data = await response.json();
  return {
    transcription: data.transcription,
    match: data.match,
    similarity: data.similarity,
  };
}
