import React, { useState } from 'react';
import { StyleSheet, StatusBar, Platform, View, Text, TouchableOpacity } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuizScreen } from './src/screens/QuizScreen';
import { colors, spacing, fontSize, borderRadius } from './src/styles/theme';
import type { Language } from './src/types';

const LANGUAGES: { code: Language; flag: string; label: string; sublabel: string }[] = [
  { code: 'de', flag: '🇩🇪', label: 'German', sublabel: 'Deutsch' },
  { code: 'nl', flag: '🇳🇱', label: 'Dutch', sublabel: 'Nederlands' },
  { code: 'fr', flag: '🇫🇷', label: 'French', sublabel: 'Français' },
];

function LanguageSelectScreen({ onSelect }: { onSelect: (lang: Language) => void }) {
  const [pressed, setPressed] = useState<Language | null>(null);

  return (
    <View style={langStyles.container}>
      <View style={langStyles.header}>
        <Text style={langStyles.title}>Language Learning</Text>
        <Text style={langStyles.subtitle}>Which language would you like to learn?</Text>
      </View>

      <View style={langStyles.buttons}>
        {LANGUAGES.map(({ code, flag, label, sublabel }) => (
          <TouchableOpacity
            key={code}
            style={[langStyles.langButton, pressed === code && langStyles.langButtonPressed]}
            onPressIn={() => setPressed(code)}
            onPressOut={() => setPressed(null)}
            onPress={() => onSelect(code)}
            activeOpacity={0.85}
          >
            <Text style={langStyles.flag}>{flag}</Text>
            <Text style={langStyles.langLabel}>{label}</Text>
            <Text style={langStyles.langSublabel}>{sublabel}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const [language, setLanguage] = useState<Language | null>(null);

  return (
    <View style={[appStyles.container, { paddingTop: insets.top }]}>
      {Platform.OS !== 'web' && <StatusBar barStyle="light-content" backgroundColor={colors.background} />}
      {language === null
        ? <LanguageSelectScreen onSelect={setLanguage} />
        : <QuizScreen language={language} onBack={() => setLanguage(null)} />
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

const langStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textAlign: 'center',
  },
  buttons: {
    width: '100%',
    maxWidth: 360,
    gap: spacing.md,
  },
  langButton: {
    backgroundColor: colors.cardBackground,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  langButtonPressed: {
    borderColor: colors.primary,
    backgroundColor: '#f0f7ff',
  },
  flag: {
    fontSize: 52,
    marginBottom: spacing.sm,
  },
  langLabel: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  langSublabel: {
    fontSize: fontSize.xs,
    color: colors.muted,
    marginTop: 2,
  },
});

export default App;
