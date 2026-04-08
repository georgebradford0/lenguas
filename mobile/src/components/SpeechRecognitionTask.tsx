import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import type { SpeechRecognitionTaskData, Language } from '../types';
import { useRecorder } from '../hooks/useRecorder';
import { useAudio } from '../hooks/useAudio';
import { comparePronunciation } from '../api/client';
import { EnglishCard } from './EnglishCard';
import { RecordButton } from './RecordButton';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';

interface SpeechRecognitionTaskProps {
  taskData: SpeechRecognitionTaskData;
  onAnswer: (userAnswer: string, correctAnswer: string) => Promise<void>;
  onBlock?: () => void;
  onTaskReady?: () => void;
  language?: Language;
}

type TaskState = 'ready' | 'recording' | 'processing' | 'feedback';

const ADVANCE_DELAY = 2000;

/**
 * Speech recognition task
 * User sees English word, speaks German translation, gets instant feedback
 */
export function SpeechRecognitionTask({
  taskData,
  onAnswer,
  onBlock,
  onTaskReady,
  language = 'de',
}: SpeechRecognitionTaskProps) {
  const { playAudio } = useAudio(language);
  const { startRecording, stopRecording, isRecording, recordingTime, error: recorderError } = useRecorder();

  const [taskState, setTaskState] = useState<TaskState>('ready');
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [similarity, setSimilarity] = useState<number | null>(null);
  const [articleMissing, setArticleMissing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Notify parent when task is ready
  useEffect(() => {
    console.log('[SpeechRecognitionTask] Mounted, word:', taskData.correctTarget);
    onTaskReady?.();
  }, [onTaskReady]);

  // Handle microphone button press
  const handleMicPress = useCallback(async () => {
    if (isRecording) {
      console.log('[SpeechRecognitionTask] Stopping recording...');
      // Stop recording and process
      setTaskState('processing');
      const audioBase64 = await stopRecording();

      console.log('[SpeechRecognitionTask] Audio captured, base64 length:', audioBase64?.length ?? 0);

      if (!audioBase64) {
        console.warn('[SpeechRecognitionTask] No audio data returned from stopRecording');
        setError('Failed to capture audio. Please try again.');
        setTaskState('ready');
        return;
      }

      try {
        console.log('[SpeechRecognitionTask] Sending to compare-pronunciation API...');
        const result = await comparePronunciation(audioBase64, taskData.correctTarget, language, taskData.pos);

        console.log('[SpeechRecognitionTask] Comparison result:', result);
        setIsCorrect(result.isCorrect);
        setSimilarity(result.similarity);
        setArticleMissing(result.articleMissing ?? false);
        setTaskState('feedback');
        playAudio(taskData.correctTargetAudio);

        // Auto-advance after delay
        setTimeout(async () => {
          await onAnswer(result.isCorrect ? taskData.correctTarget : '', taskData.correctTarget);
        }, ADVANCE_DELAY);
      } catch (err) {
        console.error('[SpeechRecognitionTask] Comparison error:', err);
        setError('Failed to analyze pronunciation. Please try again.');
        setTaskState('ready');
      }
    } else {
      console.log('[SpeechRecognitionTask] Starting recording...');
      // Start recording
      setError(null);
      setTaskState('recording');
      await startRecording();
      console.log('[SpeechRecognitionTask] startRecording() returned, isRecording should be true');
    }
  }, [isRecording, stopRecording, startRecording, taskData.correctTarget, taskData.correctTargetAudio, onAnswer, playAudio]);

  // Handle "give up" button - play correct answer and mark as incorrect
  const handleGiveUp = useCallback(async () => {
    // Play correct German audio
    await playAudio(taskData.correctTargetAudio);

    // Mark as incorrect (user gave up)
    await onAnswer('', taskData.correctTarget);
  }, [playAudio, taskData.correctTargetAudio, taskData.correctTarget, onAnswer]);

  // Render feedback state
  const renderFeedback = () => {
    return (
      <View style={styles.feedbackContainer}>
        <View style={[
          styles.feedbackCard,
          isCorrect ? styles.feedbackCorrect : styles.feedbackWrong
        ]}>
          <Text style={styles.feedbackTitle}>
            {isCorrect ? '✓ Good pronunciation!' : '✗ Keep practicing'}
          </Text>

          {articleMissing && (
            <Text style={styles.articleHint}>Don't forget the article!</Text>
          )}

          <View style={styles.correctAnswerSection}>
            <Text style={styles.correctAnswerLabel}>Correct answer:</Text>
            <Text style={styles.correctAnswerText} numberOfLines={1} adjustsFontSizeToFit>{taskData.correctTarget}</Text>
          </View>

          {similarity !== null && (
            <Text style={styles.similarityText}>
              Match: {Math.round(similarity * 100)}%
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.wrapper}>
      <EnglishCard english={taskData.english} />

      {/* Show recorder error if any */}
      {(error || recorderError) && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error || recorderError}</Text>
        </View>
      )}

      {/* Recording / Processing / Ready state */}
      {taskState === 'ready' && (
        <View style={styles.controlsContainer}>
          <RecordButton
            onPress={handleMicPress}
            isRecording={false}
          />
          <Text style={styles.hint}>Tap to record (max 5 seconds)</Text>
          <TouchableOpacity style={styles.giveUpButton} onPress={handleGiveUp}>
            <Text style={styles.giveUpText}>Hear answer</Text>
          </TouchableOpacity>
          {onBlock && (
            <TouchableOpacity style={styles.blockButton} onPress={onBlock}>
              <Text style={styles.blockButtonText}>Block word</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {taskState === 'recording' && (
        <View style={styles.controlsContainer}>
          <RecordButton
            onPress={handleMicPress}
            isRecording={true}
            recordingTime={recordingTime}
          />
          <Text style={styles.hint}>Speak now... (tap to stop)</Text>
        </View>
      )}

      {taskState === 'processing' && (
        <View style={styles.controlsContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.processingText}>Analyzing...</Text>
        </View>
      )}

      {/* Feedback state */}
      {taskState === 'feedback' && renderFeedback()}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  controlsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
  },
  giveUpButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.md,
    backgroundColor: colors.muted,
  },
  giveUpText: {
    fontSize: fontSize.md,
    color: '#fff',
    fontWeight: '600',
  },
  processingText: {
    fontSize: fontSize.md,
    color: colors.muted,
  },
  errorContainer: {
    padding: spacing.md,
    backgroundColor: colors.wrongBackground,
    borderRadius: borderRadius.md,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.wrong,
    textAlign: 'center',
  },
  feedbackContainer: {
    width: '100%',
    alignItems: 'center',
  },
  feedbackCard: {
    width: '100%',
    padding: spacing.xl,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
  },
  feedbackCorrect: {
    backgroundColor: colors.correctBackground,
    borderColor: colors.correct,
  },
  feedbackWrong: {
    backgroundColor: colors.wrongBackground,
    borderColor: colors.wrong,
  },
  feedbackTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  correctAnswerSection: {
    marginBottom: spacing.md,
  },
  correctAnswerLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
    marginBottom: spacing.xs,
  },
  correctAnswerText: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  blockButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  blockButtonText: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  articleHint: {
    fontSize: fontSize.md,
    color: colors.wrong,
    textAlign: 'center',
    marginBottom: spacing.md,
    fontWeight: '600',
  },
  similarityText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
