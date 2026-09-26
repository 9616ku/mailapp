import { useTheme } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

export function useColors() {
  const { colors, dark } = useTheme();
  return {
    ...colors,
    dark,
    muted: dark ? '#8e8e93' : '#6b6b70',
    separator: dark ? '#38383a' : '#d8d8dc',
    unread: '#0a84ff',
    danger: '#ff3b30',
  };
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: c.muted }]}>{label}</Text>
      <TextInput
        placeholderTextColor={c.muted}
        autoCapitalize="none"
        autoCorrect={false}
        {...props}
        style={[styles.input, { color: c.text, borderColor: c.separator, backgroundColor: c.card }, props.style]}
      />
    </View>
  );
}

export function Button({ title, onPress, disabled, loading }: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [styles.button, { backgroundColor: c.primary, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{title}</Text>}
    </Pressable>
  );
}

export function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const c = useColors();
  return (
    <Centered>
      <Text style={{ color: c.danger, textAlign: 'center', marginBottom: 16 }}>
        {error instanceof Error ? error.message : String(error)}
      </Text>
      {onRetry && <Button title="再試行" onPress={onRetry} />}
    </Centered>
  );
}

export function formatListDate(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  }
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

const styles = StyleSheet.create({
  field: { marginBottom: 14 },
  label: { fontSize: 13, marginBottom: 6 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', minWidth: 120 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
});
