import React, { useState } from 'react';
import { StyleSheet, StatusBar, Platform, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ReadAlongScreen } from './src/screens/ReadAlongScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { colors } from './src/styles/theme';
import type { LibrarySummary } from './src/api/client';

function AppContent() {
  const insets = useSafeAreaInsets();
  const [book, setBook] = useState<LibrarySummary | null>(null);

  return (
    <View style={[appStyles.container, { paddingTop: insets.top }]}>
      {Platform.OS !== 'web' && <StatusBar barStyle="light-content" backgroundColor={colors.background} />}
      {book === null
        ? <LibraryScreen onSelect={setBook} />
        : <ReadAlongScreen book={book} onBack={() => setBook(null)} />
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
});

export default App;
