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
  level?: string; // New: A1, A2, B1
  timesShown: number;
  correctCount: number;
  lastSeenTaskType?: string | null;
}

export interface Choice {
  text: string;
  correct: boolean;
}

export type ChoiceState = 'default' | 'correct' | 'wrong' | 'reveal' | 'disabled';

// Task types
export type TaskType = 'multipleChoice' | 'reverseTranslation' | 'audioMultipleChoice' | 'speechRecognition';
export type Level = 'A1' | 'A2' | 'B1';
export type Language = 'de' | 'nl' | 'fr' | 'es';

// Word vocabulary entry (from JSON files)
export interface VocabWord {
  word: string;
  article: string;
  pos: string; // part of speech
  full_entry: string;
}

export interface MultipleChoiceTaskData {
  target: string;
  targetAudio: string; // Singular form for audio (no plural notation)
  correctEnglish: string;
  wrongOptions: string[];
}

export interface AudioMultipleChoiceTaskData {
  targetAudio: string; // Audio only (no visual target text)
  correctEnglish: string;
  wrongOptions: string[];
}

export interface SpeechRecognitionTaskData {
  english: string;               // English word to display
  correctTarget: string;         // Expected target language answer
  correctTargetAudio: string;    // Audio for "give up" button
  pos?: string;                  // Part of speech (e.g. 'noun') — used to enforce article
}

export interface ReverseTranslationTaskData {
  english: string;
  correctTarget: string;
  correctTargetAudio: string; // Singular form for audio (no plural notation)
  wrongOptions: string[];
  wrongOptionsAudio: string[]; // Singular forms for audio
}

export type GeneratedTask = MultipleChoiceTaskData | AudioMultipleChoiceTaskData | SpeechRecognitionTaskData | ReverseTranslationTaskData;

export interface GenerateTaskResponse {
  task: GeneratedTask;
  targetWord: string;
  level: Level; // Changed from tier to level
  taskType: TaskType;
  timestamp: string;
}

export interface LevelStats {
  level: string;
  totalAttempts: number;
  correctAttempts: number;
  multipleChoiceAttempts: number;
  multipleChoiceCorrect: number;
  reverseTranslationAttempts: number;
  reverseTranslationCorrect: number;
  unlocked: boolean;
  unlockedAt: string | null;
  total: number; // total words in level
  mastered: number; // words mastered
  percentage: number; // mastery percentage
  accuracy: number; // overall accuracy for level
}

export interface LevelProgress {
  userId: string;
  currentLevel: Level;
  levelStats: LevelStats[];
  overallAccuracy: number;
  totalTasksCompleted: number;
  currentStreak: number;
  longestStreak: number;
  lastStudyDate: string | null;
}

export interface SubmitAnswerRequest {
  targetWord: string;
  level: Level;
  taskType: TaskType;
  userAnswer: string;
  correctAnswer: string;
  previousLevel?: Level;
  language?: Language;
}

export interface SubmitAnswerResponse {
  correct: boolean;
  word: string;
  level: Level; // Changed from tier
  taskType: TaskType;
  stats: {
    timesShown: number;
    correctCount: number;
    accuracy: number;
  };
  levelUnlocked: boolean; // Changed from tierUnlocked
  newLevel: Level | null; // Changed from newTier
  timestamp: string;
  transcription?: string;  // What user actually said (for speech recognition)
  similarity?: number;     // Match percentage 0-1 (for speech recognition)
}

export interface WordProgress {
  word: string;
  attempts: number;
  accuracy: number;
}

export interface LevelStatsResponse {
  currentLevel: Level;
  levelStats: LevelStats[];
  overallAccuracy: number;
  totalWords: number;
  totalAttempts: number;
  wordProgress: WordProgress[];
}

// Legacy tier types for backward compatibility
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

export interface TierStatsResponse {
  currentTier: number;
  tierStats: Array<{
    tier: number;
    total: number;
    mastered: number;
    percentage: number;
    totalAttempts: number;
    accuracy: number;
    unlocked: boolean;
  }>;
  overallAccuracy: number;
  totalWords: number;
  totalAttempts: number;
  wordProgress: WordProgress[];
}
