import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { pick, keepLocalCopy, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { getEpubTitle } from '../utils/epub';
import type { Language } from '../types';

export function ReadAlongScreen({ onBack }: { language: Language; onBack: () => void }) {
  const [epubTitle, setEpubTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelectEpub() {
    try {
      setError(null);
      const [result] = await pick({
        type: Platform.OS === 'ios' ? 'org.idpf.epub-container' : 'application/epub+zip',
      });

      setLoading(true);
      const copies = await keepLocalCopy({
        files: [{ uri: result.uri, fileName: result.name ?? 'book.epub' }],
        destination: 'cachesDirectory',
      });

      const copy = copies[0];
      if (copy.status !== 'success') {
        setError('Failed to read file.');
        return;
      }

      const title = await getEpubTitle(copy.localUri);
      setEpubTitle(title ?? result.name?.replace(/\.epub$/i, '') ?? 'Unknown Title');
    } catch (e: any) {
      if (!isErrorWithCode(e, errorCodes.OPERATION_CANCELED)) {
        setError('Failed to open file.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backText}>←</Text>
      </TouchableOpacity>

      <Text style={styles.screenTitle}>Read Along</Text>

      {epubTitle ? (
        <View style={styles.bookCard}>
          <Text style={styles.bookIcon}>📖</Text>
          <Text style={styles.bookTitle}>{epubTitle}</Text>
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <TouchableOpacity style={styles.selectButton} onPress={handleSelectEpub} activeOpacity={0.85}>
          <Text style={styles.selectButtonText}>
            {epubTitle ? 'Change Book' : 'Select EPUB'}
          </Text>
        </TouchableOpacity>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  backButton: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    padding: spacing.xs,
  },
  backText: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  screenTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  bookCard: {
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
    width: '100%',
    maxWidth: 400,
  },
  bookIcon: {
    fontSize: 40,
    marginBottom: spacing.xs,
  },
  bookTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
  loader: {
    marginTop: spacing.md,
  },
  selectButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  selectButtonText: {
    color: '#fff',
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  error: {
    color: colors.wrong,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
