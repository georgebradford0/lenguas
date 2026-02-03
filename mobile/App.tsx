import React from 'react';
import { StyleSheet, StatusBar, Platform, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuizScreen } from './src/screens/QuizScreen';
import { colors } from './src/styles/theme';

function AppContent() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {Platform.OS !== 'web' && <StatusBar barStyle="light-content" backgroundColor={colors.background} />}
      <QuizScreen />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
});

export default App;
