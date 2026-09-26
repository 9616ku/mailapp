import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Button, Field, useColors } from '@/components/ui';
import { presetForEmail } from '@/mail/presets';
import { verifyAccount } from '@/mail/service';
import type { Account, ServerConfig } from '@/mail/types';
import { useAccount } from '@/store/account';

type ServerForm = { host: string; port: string; starttls: boolean };

const toForm = (s: ServerConfig): ServerForm => ({ host: s.host, port: String(s.port), starttls: s.security === 'starttls' });
const fromForm = (f: ServerForm): ServerConfig => ({ host: f.host.trim(), port: Number(f.port), security: f.starttls ? 'starttls' : 'tls' });

export default function LoginScreen() {
  const c = useColors();
  const save = useAccount((s) => s.save);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [manual, setManual] = useState(false);
  const [imap, setImap] = useState<ServerForm>({ host: '', port: '993', starttls: false });
  const [smtp, setSmtp] = useState<ServerForm>({ host: '', port: '465', starttls: false });
  const [busy, setBusy] = useState(false);

  const preset = presetForEmail(email);

  const onEmailBlur = () => {
    const p = presetForEmail(email);
    if (p) {
      setImap(toForm(p.imap));
      setSmtp(toForm(p.smtp));
    } else if (email.includes('@') && !imap.host) {
      const domain = email.split('@')[1];
      setImap({ host: `imap.${domain}`, port: '993', starttls: false });
      setSmtp({ host: `smtp.${domain}`, port: '465', starttls: false });
      setManual(true);
    }
  };

  const onSubmit = async () => {
    const account: Account = {
      email: email.trim(),
      displayName: displayName.trim(),
      username: (username || email).trim(),
      password,
      imap: fromForm(imap),
      smtp: fromForm(smtp),
    };
    if (!account.imap.host || !account.smtp.host) {
      setManual(true);
      Alert.alert('サーバー情報を入力してください');
      return;
    }
    setBusy(true);
    try {
      await verifyAccount(account);
      await save(account);
    } catch (e) {
      Alert.alert('接続できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const serverFields = (label: string, v: ServerForm, set: (f: ServerForm) => void) => (
    <View style={[styles.section, { borderColor: c.separator }]}>
      <Text style={[styles.sectionTitle, { color: c.text }]}>{label}</Text>
      <Field label="ホスト" value={v.host} onChangeText={(host) => set({ ...v, host })} placeholder="imap.example.com" />
      <Field label="ポート" value={v.port} onChangeText={(port) => set({ ...v, port })} keyboardType="number-pad" />
      <View style={styles.row}>
        <Text style={{ color: c.text }}>STARTTLS（オフならSSL/TLS）</Text>
        <Switch value={v.starttls} onValueChange={(starttls) => set({ ...v, starttls })} />
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Field
          label="メールアドレス"
          value={email}
          onChangeText={setEmail}
          onBlur={onEmailBlur}
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@example.com"
        />
        <Field label="表示名" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" placeholder="山田 太郎" />
        <Field label="パスワード" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" />
        {preset?.note && <Text style={[styles.note, { color: c.muted }]}>{preset.note}</Text>}

        <Pressable onPress={() => setManual(!manual)}>
          <Text style={[styles.link, { color: c.primary }]}>{manual ? '詳細設定を閉じる' : '詳細設定（サーバー）'}</Text>
        </Pressable>

        {manual && (
          <>
            <Field label="ユーザー名（空欄ならメールアドレス）" value={username} onChangeText={setUsername} />
            {serverFields('受信（IMAP）', imap, setImap)}
            {serverFields('送信（SMTP）', smtp, setSmtp)}
          </>
        )}

        <Button title="ログイン" onPress={onSubmit} loading={busy} disabled={!email || !password} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 60 },
  note: { fontSize: 13, marginBottom: 14, lineHeight: 19 },
  link: { fontSize: 15, marginBottom: 16 },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, marginBottom: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '600', marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
});
