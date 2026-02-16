import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View, Animated } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';

interface RecordButtonProps {
  onPress: () => void;
  isRecording: boolean;
  recordingTime?: number;
  disabled?: boolean;
}

export function RecordButton({
  onPress,
  isRecording,
  recordingTime = 0,
  disabled = false,
}: RecordButtonProps) {
  // Format recording time as seconds
  const seconds = Math.floor(recordingTime / 1000);
  const milliseconds = Math.floor((recordingTime % 1000) / 100);
  const timeDisplay = `${seconds}.${milliseconds}s`;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[
          styles.button,
          isRecording && styles.buttonRecording,
          disabled && styles.buttonDisabled,
        ]}
        onPress={onPress}
        activeOpacity={0.7}
        disabled={disabled}
      >
        <Text style={styles.icon}>{isRecording ? '⏹' : '🎤'}</Text>
      </TouchableOpacity>
      {isRecording && (
        <View style={styles.recordingIndicator}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>{timeDisplay}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.lg,
  },
  button: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  buttonRecording: {
    backgroundColor: colors.wrong,
  },
  buttonDisabled: {
    backgroundColor: colors.muted,
    opacity: 0.5,
  },
  icon: {
    fontSize: fontSize.xl * 2,
  },
  recordingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  recordingDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.wrong,
    marginRight: spacing.sm,
  },
  recordingText: {
    fontSize: fontSize.lg,
    color: colors.text,
    fontWeight: '600',
  },
});
