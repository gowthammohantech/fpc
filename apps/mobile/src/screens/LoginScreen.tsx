import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { useAuth } from '../lib/auth';
import { Button } from '../components/ui';
import { colors, styles } from '../lib/theme';

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
    } catch (caught) {
      setError((caught as Error).message || 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { justifyContent: 'center' }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={{ padding: 24, gap: 16 }}>
        <View>
          <Text style={[styles.title, { color: colors.brand }]}>Finance Ops</Text>
          <Text style={styles.muted}>Approve payments on the go</Text>
        </View>

        {error ? (
          <View
            style={[styles.card, { backgroundColor: colors.dangerBg, borderColor: colors.danger }]}
          >
            <Text style={{ color: colors.danger }}>{error}</Text>
          </View>
        ) : null}

        <View>
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            inputMode="email"
          />
        </View>

        <View>
          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            onSubmitEditing={() => void submit()}
          />
        </View>

        <Button
          label={busy ? 'Signing in…' : 'Sign in'}
          onPress={() => void submit()}
          disabled={busy || !email || !password}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
