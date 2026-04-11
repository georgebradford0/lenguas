import React, { useCallback } from 'react';
import { FlatList, Text, StyleSheet, ListRenderItemInfo } from 'react-native';
import type { Chapter, Paragraph, Sentence } from '../utils/epubParser';
import { colors, spacing, fontSize } from '../styles/theme';

interface Props {
  chapter: Chapter;
  selectedWordId: string | null;
  highlightedSentenceId: string | null;
  onWordPress: (wordId: string, word: string, sentence: Sentence) => void;
  onWordLongPress: (wordId: string, word: string, sentence: Sentence) => void;
  bottomPadding?: number;
}

export function EpubReader({
  chapter,
  selectedWordId,
  highlightedSentenceId,
  onWordPress,
  onWordLongPress,
  bottomPadding = 0,
}: Props) {
  const renderParagraph = useCallback(
    ({ item }: ListRenderItemInfo<Paragraph>) => (
      <ParagraphItem
        paragraph={item}
        selectedWordId={selectedWordId}
        highlightedSentenceId={highlightedSentenceId}
        onWordPress={onWordPress}
        onWordLongPress={onWordLongPress}
      />
    ),
    [selectedWordId, highlightedSentenceId, onWordPress, onWordLongPress],
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
  highlightedSentenceId: string | null;
  onWordPress: (wordId: string, word: string, sentence: Sentence) => void;
  onWordLongPress: (wordId: string, word: string, sentence: Sentence) => void;
}

const ParagraphItem = React.memo(({
  paragraph, selectedWordId, highlightedSentenceId, onWordPress, onWordLongPress,
}: ParagraphItemProps) => (
  <Text style={styles.paragraph}>
    {paragraph.sentences.flatMap(sentence => {
      const isHighlighted = highlightedSentenceId === sentence.id;
      return sentence.words.map(word =>
        word.isWord ? (
          <Text
            key={word.id}
            onPress={() => onWordPress(word.id, word.text, sentence)}
            onLongPress={() => onWordLongPress(word.id, word.text, sentence)}
            style={[
              styles.word,
              isHighlighted && styles.highlightedWord,
              selectedWordId === word.id && styles.selectedWord,
            ]}
          >
            {word.text}
          </Text>
        ) : (
          <Text key={word.id} style={isHighlighted ? styles.highlightedSpace : undefined}>
            {word.text}
          </Text>
        ),
      );
    })}
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
  highlightedWord: {
    color: '#92400e',
    backgroundColor: '#fef3c7',
  },
  highlightedSpace: {
    backgroundColor: '#fef3c7',
  },
});
