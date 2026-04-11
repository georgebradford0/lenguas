import React from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onSentenceBysentence: () => void;
}

export function WordContextMenu({ visible, onDismiss, onSentenceBysentence }: Props) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <View style={styles.menu}>
          <TouchableOpacity
            style={styles.option}
            onPress={() => { onDismiss(); onSentenceBysentence(); }}
            activeOpacity={0.7}
          >
            <Text style={styles.optionIcon}>📖</Text>
            <Text style={styles.optionText}>Sentence by Sentence</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 220,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 12,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  optionIcon: {
    fontSize: 20,
  },
  optionText: {
    fontSize: fontSize.xs,
    fontWeight: '500',
    color: colors.text,
  },
});
