import React, { useState } from 'react';
import {
  StyleSheet, StatusBar, Platform, View, Text, TouchableOpacity,
} from 'react-native';
import { useIsTablet } from './src/hooks/useIsTablet';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ReadAlongScreen } from './src/screens/ReadAlongScreen';
import { colors, spacing, fontSize, borderRadius } from './src/styles/theme';
import type { Language } from './src/types';

const LANGUAGES: { code: Language; flag: string; label: string; sublabel: string }[] = [
  { code: 'de', flag: '🇩🇪', label: 'German', sublabel: 'Deutsch' },
  { code: 'nl', flag: '🇳🇱', label: 'Dutch', sublabel: 'Nederlands' },
  { code: 'fr', flag: '🇫🇷', label: 'French', sublabel: 'Français' },
  { code: 'es', flag: '🇪🇸', label: 'Spanish', sublabel: 'Español' },
];

function LanguageSelectScreen({ onSelect }: { onSelect: (lang: Language) => void }) {
  const [pressed, setPressed] = useState<Language | null>(null);
  const isTablet = useIsTablet();

  return (
    <View style={langStyles.container}>
      <View style={[langStyles.buttons, isTablet && langStyles.buttonsTablet]}>
        {LANGUAGES.map(({ code, flag, label, sublabel }) => (
          <TouchableOpacity
            key={code}
            style={[
              langStyles.langButton,
              isTablet && langStyles.langButtonTablet,
              pressed === code && langStyles.langButtonPressed,
            ]}
            onPressIn={() => setPressed(code)}
            onPressOut={() => setPressed(null)}
            onPress={() => onSelect(code)}
            activeOpacity={0.85}
          >
            <Text style={[langStyles.flag, isTablet && langStyles.flagTablet]}>{flag}</Text>
            <Text style={[langStyles.langLabel, isTablet && langStyles.langLabelTablet]}>{label}</Text>
            <Text style={[langStyles.langSublabel, isTablet && langStyles.langSublabelTablet]}>{sublabel}</Text>
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
        : <ReadAlongScreen language={language} onBack={() => setLanguage(null)} />
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
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  buttons: {
    width: '100%',
    maxWidth: 400,
    gap: spacing.xs,
  },
  buttonsTablet: {
    maxWidth: 720,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  langButton: {
    backgroundColor: colors.cardBackground,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 3,
  },
  langButtonTablet: {
    width: '48%',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  langButtonPressed: {
    borderColor: colors.primary,
    backgroundColor: '#f0f7ff',
  },
  flag: {
    fontSize: 36,
    marginBottom: spacing.xs,
  },
  flagTablet: {
    fontSize: 52,
    marginBottom: spacing.sm,
  },
  langLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.text,
  },
  langLabelTablet: {
    fontSize: fontSize.md,
  },
  langSublabel: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  langSublabelTablet: {
    fontSize: fontSize.xs,
  },
});

export default App;
