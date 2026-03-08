import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, StatusBar, Platform, View, Text, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Alert, Modal, Pressable,
} from 'react-native';
import { useIsTablet } from './src/hooks/useIsTablet';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuizScreen } from './src/screens/QuizScreen';
import { colors, spacing, fontSize, borderRadius } from './src/styles/theme';
import { loginRequest, verifyCode, setAuthToken, deleteAccount } from './src/api/client';
import { saveAuthData, loadAuthData, clearAuthData } from './src/utils/auth';
import type { Language } from './src/types';

const LANGUAGES: { code: Language; flag: string; label: string; sublabel: string }[] = [
  { code: 'de', flag: '🇩🇪', label: 'German', sublabel: 'Deutsch' },
  { code: 'nl', flag: '🇳🇱', label: 'Dutch', sublabel: 'Nederlands' },
  { code: 'fr', flag: '🇫🇷', label: 'French', sublabel: 'Français' },
  { code: 'es', flag: '🇪🇸', label: 'Spanish', sublabel: 'Español' },
];

function LanguageSelectScreen({ onSelect, onLogout }: { onSelect: (lang: Language) => void; onLogout: () => void }) {
  const [pressed, setPressed] = useState<Language | null>(null);
  const [menuVisible, setMenuVisible] = useState(false);
  const isTablet = useIsTablet();

  function handleDeleteAccount() {
    setMenuVisible(false);
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all progress. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteAccount();
              onLogout();
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Failed to delete account. Please try again.');
            }
          },
        },
      ]
    );
  }

  return (
    <View style={langStyles.container}>
      <TouchableOpacity style={langStyles.settingsButton} onPress={() => setMenuVisible(true)}>
        <Text style={langStyles.settingsIcon}>⚙️</Text>
      </TouchableOpacity>

      <Modal transparent visible={menuVisible} animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <Pressable style={langStyles.menuOverlay} onPress={() => setMenuVisible(false)}>
          <View style={langStyles.menuDropdown}>
            <TouchableOpacity
              style={langStyles.menuItem}
              onPress={() => { setMenuVisible(false); onLogout(); }}
            >
              <Text style={langStyles.menuItemText}>Logout</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[langStyles.menuItem, langStyles.menuItemBorderTop]}
              onPress={handleDeleteAccount}
            >
              <Text style={langStyles.menuItemText}>Delete Account</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

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

type AuthStep = 'loading' | 'email' | 'code' | 'language' | 'quiz';

function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const codeInputRef = useRef<TextInput>(null);
  const isTablet = useIsTablet();

  async function handleSendCode() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await loginRequest(trimmed);
      setStep('code');
      setTimeout(() => codeInputRef.current?.focus(), 200);
    } catch (e: any) {
      setError(e.message || 'Failed to send code. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode() {
    const trimmed = code.trim();
    if (trimmed.length !== 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { token, userId } = await verifyCode(email.trim().toLowerCase(), trimmed);
      setAuthToken(token);
      await saveAuthData({ token, userId });
      onAuthenticated();
    } catch (e: any) {
      setError(e.message || 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={loginStyles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[loginStyles.card, isTablet && loginStyles.cardTablet]}>
        <Text style={loginStyles.title}>Lenguas</Text>
        <Text style={loginStyles.subtitle}>
          {step === 'email' ? 'Enter your email to continue' : `Code sent to ${email}`}
        </Text>

        {step === 'email' ? (
          <>
            <TextInput
              style={loginStyles.input}
              placeholder="Email address"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={t => { setEmail(t); setError(''); }}
              onSubmitEditing={handleSendCode}
              returnKeyType="send"
              editable={!loading}
            />
            <TouchableOpacity
              style={[loginStyles.button, loading && loginStyles.buttonDisabled]}
              onPress={handleSendCode}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={loginStyles.buttonText}>Send Code</Text>
              }
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput
              ref={codeInputRef}
              style={[loginStyles.input, loginStyles.codeInput]}
              placeholder="6-digit code"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={t => { setCode(t); setError(''); }}
              onSubmitEditing={handleVerifyCode}
              returnKeyType="done"
              editable={!loading}
            />
            <TouchableOpacity
              style={[loginStyles.button, loading && loginStyles.buttonDisabled]}
              onPress={handleVerifyCode}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={loginStyles.buttonText}>Verify</Text>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={loginStyles.backLink}
              onPress={() => { setStep('email'); setCode(''); setError(''); }}
            >
              <Text style={loginStyles.backLinkText}>Use a different email</Text>
            </TouchableOpacity>
          </>
        )}

        {error ? <Text style={loginStyles.error}>{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const [authStep, setAuthStep] = useState<AuthStep>('loading');
  const [language, setLanguage] = useState<Language | null>(null);

  useEffect(() => {
    loadAuthData().then(data => {
      if (data?.token) {
        setAuthToken(data.token);
        setAuthStep('language');
      } else {
        setAuthStep('email');
      }
    });
  }, []);

  function handleLogout() {
    clearAuthData();
    setAuthToken(null);
    setLanguage(null);
    setAuthStep('email');
  }

  if (authStep === 'loading') {
    return (
      <View style={[appStyles.container, appStyles.center]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[appStyles.container, { paddingTop: insets.top }]}>
      {Platform.OS !== 'web' && <StatusBar barStyle="light-content" backgroundColor={colors.background} />}
      {authStep === 'email' || authStep === 'code'
        ? <LoginScreen onAuthenticated={() => setAuthStep('language')} />
        : language === null
          ? <LanguageSelectScreen onSelect={setLanguage} onLogout={handleLogout} />
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
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const loginStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
  },
  cardTablet: {
    maxWidth: 560,
    elevation: 4,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.xs,
    color: colors.muted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.xs,
    color: colors.text,
    marginBottom: spacing.md,
    backgroundColor: colors.background,
  },
  codeInput: {
    textAlign: 'center',
    fontSize: fontSize.lg,
    letterSpacing: 8,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
  backLink: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  backLinkText: {
    color: colors.primary,
    fontSize: fontSize.xs,
  },
  error: {
    color: colors.wrong,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.xs,
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
  settingsButton: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    padding: spacing.xs,
  },
  settingsIcon: {
    fontSize: 24,
  },
  menuOverlay: {
    flex: 1,
  },
  menuDropdown: {
    position: 'absolute',
    top: spacing.md + 36,
    right: spacing.md,
    backgroundColor: colors.cardBackground,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
    minWidth: 140,
  },
  menuItem: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  menuItemBorderTop: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  menuItemText: {
    fontSize: fontSize.xs,
    color: colors.wrong,
    fontWeight: '500',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  headerTablet: {
    marginBottom: spacing.xxl,
  },
  title: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.xs,
  },
  titleTablet: {
    fontSize: fontSize.xxl,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
  },
  subtitleTablet: {
    fontSize: fontSize.xs,
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
