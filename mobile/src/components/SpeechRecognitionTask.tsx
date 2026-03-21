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
  onTaskReady,
  language = 'de',
}: SpeechRecognitionTaskProps) {
  const { playAudio } = useAudio(language);
  const { startRecording, stopRecording, isRecording, recordingTime, error: recorderError } = useRecorder();

  const [taskState, setTaskState] = useState<TaskState>('ready');
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [similarity, setSimilarity] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Notify parent when task is ready
  useEffect(() => {
    console.log('[SpeechRecognitionTask] Mounted, word:', taskData.correctGerman);
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
        const result = await comparePronunciation(audioBase64, taskData.correctGerman, language);

        console.log('[SpeechRecognitionTask] Comparison result:', result);
        setIsCorrect(result.isCorrect);
        setSimilarity(result.similarity);
        setTaskState('feedback');
        playAudio(taskData.correctGermanAudio);

        // Auto-advance after delay
        setTimeout(async () => {
          await onAnswer(result.isCorrect ? taskData.correctGerman : '', taskData.correctGerman);
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
  }, [isRecording, stopRecording, startRecording, taskData.correctGerman, taskData.correctGermanAudio, onAnswer, playAudio]);

  // Handle "give up" button - play correct answer and mark as incorrect
  const handleGiveUp = useCallback(async () => {
    // Play correct German audio
    await playAudio(taskData.correctGermanAudio);

    // Mark as incorrect (user gave up)
    await onAnswer('', taskData.correctGerman);
  }, [playAudio, taskData.correctGermanAudio, taskData.correctGerman, onAnswer]);

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

          <View style={styles.correctAnswerSection}>
            <Text style={styles.correctAnswerLabel}>Correct answer:</Text>
            <Text style={styles.correctAnswerText}>{taskData.correctGerman}</Text>
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
  },
  controlsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  hint: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  giveUpButton: {
    marginTop: spacing.lg,
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
    marginTop: spacing.md,
  },
  errorContainer: {
    padding: spacing.md,
    backgroundColor: colors.wrongBackground,
    borderRadius: borderRadius.md,
    marginTop: spacing.md,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.wrong,
    textAlign: 'center',
  },
  feedbackContainer: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.lg,
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
  similarityText: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
