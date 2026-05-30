import React, { useEffect, useState } from 'react';
import { StyleSheet, StatusBar, Platform, View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ReadAlongScreen } from './src/screens/ReadAlongScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { colors } from './src/styles/theme';
import { getLastOpenedBook, setLastOpenedBook, clearCachedBooks } from './src/utils/bookStorage';
import type { LibrarySummary } from './src/api/client';

function AppContent() {
  const insets = useSafeAreaInsets();
  const [book, setBook] = useState<LibrarySummary | null>(null);
  const [bootChecked, setBootChecked] = useState(false);

  // Auto-resume the last book that was open when the app was killed.
  // Cleared explicitly when the user taps "back to library", so a deliberate
  // exit doesn't reopen into the reader on next launch.
  //
  // Before resuming, forcibly drop the cached book content so every book
  // re-downloads fresh on open. Book content hashes are derived from the EPUB
  // bytes, so a re-parsed book keeps the same hash and the cache would otherwise
  // serve stale content indefinitely.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await clearCachedBooks();
      const last = await getLastOpenedBook();
      if (!cancelled) {
        if (last) setBook(last);
        setBootChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function openBook(b: LibrarySummary) {
    setBook(b);
    setLastOpenedBook(b).catch(() => {});
  }

  function closeBook() {
    setBook(null);
    setLastOpenedBook(null).catch(() => {});
  }

  return (
    <View style={[appStyles.container, { paddingTop: insets.top }]}>
      {Platform.OS !== 'web' && <StatusBar barStyle="light-content" backgroundColor={colors.background} />}
      {!bootChecked
        ? (
          <View style={appStyles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )
        : book === null
          ? <LibraryScreen onSelect={openBook} />
          : <ReadAlongScreen book={book} onBack={closeBook} />
      }
    </View>
  );
}

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const appStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default App;
