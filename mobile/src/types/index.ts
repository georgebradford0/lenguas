// Legacy types (kept for backward compatibility)
export interface WordData {
  word: string;
  tier: number;
}

export interface Card {
  word: string;
  tier: number;
  timesShown: number;
  correctCount: number;
  taskType?: 'multipleChoice' | 'reverseTranslation';
  lastSeenTaskType?: string | null;
}

export interface TranslationResult {
  word: string;
  translation: string;
  wrong: string[];
}

export interface ProgressRecord {
  word: string;
  tier?: number;
  timesShown: number;
  correctCount: number;
  lastSeenTaskType?: string | null;
}

export interface Choice {
  text: string;
  correct: boolean;
}

export type ChoiceState = 'default' | 'correct' | 'wrong' | 'reveal' | 'disabled';

// New LLM-based task types
export type TaskType = 'multipleChoice' | 'reverseTranslation';

export interface MultipleChoiceTaskData {
  german: string;
  correctEnglish: string;
  wrongOptions: string[];
  chunkPattern?: string;
  focusGrammar?: string;
}

export interface ReverseTranslationTaskData {
  english: string;
  correctGerman: string;
  wrongOptions: string[];
  chunkPattern?: string;
  focusGrammar?: string;
}

export type GeneratedTask = MultipleChoiceTaskData | ReverseTranslationTaskData;

export interface GenerateTaskResponse {
  task: GeneratedTask;
  tier: number;
  taskType: TaskType;
  timestamp: string;
}

export interface TierStats {
  totalAttempts: number;
  correctAttempts: number;
  multipleChoiceAttempts: number;
  multipleChoiceCorrect: number;
  reverseTranslationAttempts: number;
  reverseTranslationCorrect: number;
  unlocked: boolean;
  unlockedAt: string | null;
}

export interface TierProgress {
  userId: string;
  currentTier: number;
  tierStats: {
    tier1: TierStats;
    tier2: TierStats;
    tier3: TierStats;
    tier4: TierStats;
  };
  overallAccuracy: number;
  totalTasksCompleted: number;
  currentStreak: number;
  longestStreak: number;
  lastStudyDate: string | null;
}

export interface SubmitAnswerRequest {
  userId?: string;
  tier: number;
  taskType: TaskType;
  userAnswer: string;
  correctAnswer: string;
  taskData?: any;
}

export interface SubmitAnswerResponse {
  correct: boolean;
  tier: number;
  taskType: TaskType;
  tierUnlocked: boolean;
  currentTier: number;
  stats: {
    accuracy: number;
    totalAttempts: number;
    correctAttempts: number;
    overallAccuracy: number;
  };
  timestamp: string;
}
