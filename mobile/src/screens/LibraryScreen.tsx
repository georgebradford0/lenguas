import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  FlatList, ListRenderItemInfo,
} from 'react-native';
import { colors, spacing, fontSize, borderRadius } from '../styles/theme';
import { listLibrary } from '../api/client';
import type { LibrarySummary } from '../api/client';
import {
  cacheAllLibrary, loadCachedAllLibrary, hasCachedBook,
} from '../utils/bookStorage';

const FLAGS: Record<string, string> = {
  de: '🇩🇪',
  nl: '🇳🇱',
  fr: '🇫🇷',
  es: '🇪🇸',
};

export function LibraryScreen({ onSelect }: { onSelect: (book: LibrarySummary) => void }) {
  const [books, setBooks] = useState<LibrarySummary[]>([]);
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let list: LibrarySummary[];
        try {
          list = await listLibrary();
          await cacheAllLibrary(list);
        } catch (e) {
          console.warn('[Library] fetch failed, using cache:', (e as any)?.message);
          list = (await loadCachedAllLibrary()) ?? [];
          if (list.length === 0) {
            throw e;
          }
        }
        if (cancelled) return;

        // Sort: language, then title.
        list.sort((a, b) => a.language.localeCompare(b.language) || a.title.localeCompare(b.title));
        setBooks(list);

        const have = new Set<string>();
        for (const b of list) {
          if (await hasCachedBook(b.contentHash)) have.add(b.contentHash);
        }
        if (cancelled) return;
        setDownloaded(have);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load library.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  if (books.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📚</Text>
        <Text style={styles.emptyText}>No books in the library yet.{'\n'}Run the parse CLI to add some.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Library</Text>
        <Text style={styles.headerCount}>{books.length} book{books.length === 1 ? '' : 's'}</Text>
      </View>
      <FlatList
        data={books}
        keyExtractor={b => b.contentHash}
        renderItem={({ item }: ListRenderItemInfo<LibrarySummary>) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => onSelect(item)}
            activeOpacity={0.7}
          >
            <Text style={styles.flag}>{FLAGS[item.language] ?? item.language.toUpperCase()}</Text>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
              {item.author ? (
                <Text style={styles.rowAuthor} numberOfLines={1}>{item.author}</Text>
              ) : null}
            </View>
            <View style={styles.rowMeta}>
              {item.difficulty ? (
                <Text style={styles.badge}>{item.difficulty}</Text>
              ) : null}
              {!downloaded.has(item.contentHash) ? (
                <Text style={styles.cloud}>☁️</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={{ paddingBottom: spacing.xl }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1, backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  empty: {
    flex: 1, backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyIcon: { fontSize: 48, marginBottom: spacing.sm, opacity: 0.6 },
  emptyText: { color: colors.muted, fontSize: fontSize.xs, textAlign: 'center', lineHeight: 22 },
  errorText: { color: colors.wrong, fontSize: 14, textAlign: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.cardBackground,
  },
  headerTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.text },
  headerCount: { fontSize: 13, color: colors.muted },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  flag: {
    fontSize: 22,
    marginRight: spacing.sm,
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontSize: fontSize.xs,
    color: colors.text,
    fontWeight: '500',
  },
  rowAuthor: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.xs,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cloud: {
    fontSize: 14,
    marginLeft: spacing.xs,
    opacity: 0.6,
  },
  separator: { height: 1, backgroundColor: colors.border },
});
