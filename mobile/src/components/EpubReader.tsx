import React, { useCallback } from 'react';
import { FlatList, Text, View, StyleSheet, ListRenderItemInfo } from 'react-native';
import type { Chapter, Paragraph, Sentence } from '../utils/epubParser';
import { colors, spacing, fontSize } from '../styles/theme';

interface Props {
  chapter: Chapter;
  selectedWordId: string | null;
  onWordPress: (wordId: string, word: string, sentence: Sentence) => void;
  bottomPadding?: number;
}

export function EpubReader({ chapter, selectedWordId, onWordPress, bottomPadding = 0 }: Props) {
  const renderParagraph = useCallback(
    ({ item }: ListRenderItemInfo<Paragraph>) => (
      <ParagraphItem
        paragraph={item}
        selectedWordId={selectedWordId}
        onWordPress={onWordPress}
      />
    ),
    [selectedWordId, onWordPress],
  );

  return (
    <FlatList
      data={chapter.paragraphs}
      keyExtractor={p => p.id}
      renderItem={renderParagraph}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPadding + spacing.xl }]}
      removeClippedSubviews
      initialNumToRender={20}
      maxToRenderPerBatch={20}
      windowSize={10}
    />
  );
}

interface ParagraphItemProps {
  paragraph: Paragraph;
  selectedWordId: string | null;
  onWordPress: (wordId: string, word: string, sentence: Sentence) => void;
}

const ParagraphItem = React.memo(({ paragraph, selectedWordId, onWordPress }: ParagraphItemProps) => (
  <Text style={styles.paragraph}>
    {paragraph.sentences.flatMap(sentence =>
      sentence.words.map(word =>
        word.isWord ? (
          <Text
            key={word.id}
            onPress={() => onWordPress(word.id, word.text, sentence)}
            style={selectedWordId === word.id ? styles.selectedWord : styles.word}
          >
            {word.text}
          </Text>
        ) : (
          <Text key={word.id}>{word.text}</Text>
        ),
      ),
    )}
  </Text>
));

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  paragraph: {
    fontSize: fontSize.xs,
    color: colors.text,
    lineHeight: fontSize.xs * 1.65,
    marginBottom: spacing.md,
    flexWrap: 'wrap',
  },
  word: {
    color: colors.text,
  },
  selectedWord: {
    color: colors.primary,
    backgroundColor: '#dbeafe',
    borderRadius: 3,
  },
});
