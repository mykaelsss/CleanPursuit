import { useRef, useState, type Ref } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Mode = 'signIn' | 'signUp';

// These mirror the API's rules, so most mistakes are caught before a round trip.
const USERNAME = /^[A-Za-z0-9_]{3,32}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(mode: Mode, fields: { identifier: string; username: string; email: string; password: string }) {
  if (mode === 'signIn') {
    if (!fields.identifier.trim()) return 'Enter your username or email';
    if (!fields.password) return 'Enter your password';
    return null;
  }
  if (!USERNAME.test(fields.username)) return 'Usernames are 3 to 32 letters, digits or underscores';
  if (!EMAIL.test(fields.email.trim())) return 'Enter a valid email';
  if (fields.password.length < 8) return 'Passwords need at least 8 characters';
  if (fields.password.length > 128) return 'Passwords can be at most 128 characters';
  return null;
}

export default function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>('signIn');
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  async function submit() {
    if (submitting) return;
    const problem = validate(mode, { identifier, username, email, password });
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'signIn') await signIn(identifier.trim(), password);
      else await signUp(username, email.trim(), password);
      // On success the root layout swaps this screen for the tabs.
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach CleanPursuit. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  const signingUp = mode === 'signUp';

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <ThemedText type="subtitle" style={{ color: theme.tint }}>
                CleanPursuit
              </ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.centered}>
                Report litter, rally a party to clean it up and earn XP.
              </ThemedText>
            </View>

            <ThemedView type="backgroundElement" style={styles.segmented}>
              <Segment label="Log in" active={!signingUp} onPress={() => switchMode('signIn')} />
              <Segment label="Sign up" active={signingUp} onPress={() => switchMode('signUp')} />
            </ThemedView>

            <View style={styles.form}>
              {signingUp ? (
                <>
                  <Field
                    label="Username"
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username-new"
                    textContentType="username"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => emailRef.current?.focus()}
                  />
                  <Field
                    ref={emailRef}
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                  />
                </>
              ) : (
                <Field
                  label="Username or email"
                  value={identifier}
                  onChangeText={setIdentifier}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="username"
                  textContentType="username"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
              )}
              <Field
                ref={passwordRef}
                label="Password"
                hint={signingUp ? 'At least 8 characters' : undefined}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete={signingUp ? 'new-password' : 'current-password'}
                textContentType={signingUp ? 'newPassword' : 'password'}
                returnKeyType="go"
                onSubmitEditing={submit}
              />

              {error && (
                <ThemedText type="small" themeColor="error" accessibilityRole="alert">
                  {error}
                </ThemedText>
              )}

              <Pressable
                onPress={submit}
                disabled={submitting}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: theme.tint },
                  (pressed || submitting) && styles.pressed,
                ]}>
                {submitting ? (
                  <ActivityIndicator color={theme.onTint} />
                ) : (
                  <ThemedText themeColor="onTint" style={styles.buttonLabel}>
                    {signingUp ? 'Create account' : 'Log in'}
                  </ThemedText>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Segment({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      style={styles.segment}>
      <ThemedView type={active ? 'background' : 'backgroundElement'} style={styles.segmentInner}>
        <ThemedText type="smallBold" themeColor={active ? 'text' : 'textSecondary'}>
          {label}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

function Field({
  label,
  hint,
  ref,
  ...props
}: TextInputProps & { label: string; hint?: string; ref?: Ref<TextInput> }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        {...props}
      />
      {hint && (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
    padding: Spacing.four,
    gap: Spacing.four,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  centered: {
    textAlign: 'center',
  },
  segmented: {
    flexDirection: 'row',
    padding: Spacing.one,
    borderRadius: Spacing.three,
  },
  segment: {
    flex: 1,
  },
  segmentInner: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two + Spacing.half,
  },
  form: {
    gap: Spacing.three,
  },
  field: {
    gap: Spacing.one,
  },
  input: {
    fontSize: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    borderRadius: Spacing.two + Spacing.one,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: Spacing.two + Spacing.one,
    marginTop: Spacing.two,
  },
  buttonLabel: {
    fontWeight: 700,
  },
  pressed: {
    opacity: 0.7,
  },
});
