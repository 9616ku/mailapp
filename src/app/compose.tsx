import { useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { useColors } from '@/components/ui';
import {
  buildReferences,
  isValidAddress,
  parseAddressList,
  quoteText,
  replySubject,
} from '@/mail/mime/compose';
import { flattenAddresses } from '@/mail/mime/parse';
import { fetchMessage, send } from '@/mail/service';
import type { AddressInfo } from '@/mail/types';
import { useAccount } from '@/store/account';

type Mode = 'new' | 'reply' | 'replyAll' | 'forward';

const joinAddresses = (list: AddressInfo[]) => list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');

export default function ComposeScreen() {
  const params = useLocalSearchParams<{ mode?: Mode; folder?: string; uid?: string }>();
  const mode: Mode = params.mode ?? 'new';
  const c = useColors();
  const account = useAccount((s) => s.account)!;
  const qc = useQueryClient();

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [threading, setThreading] = useState<{ inReplyTo?: string; references?: string[] }>({});
  const [sending, setSending] = useState(false);
  const [loadingOriginal, setLoadingOriginal] = useState(mode !== 'new');

  // Prefill recipients, subject and quoted text from the original message.
  useEffect(() => {
    if (mode === 'new' || !params.folder || !params.uid) return;
    const folder = params.folder;
    const uid = Number(params.uid);
    qc.fetchQuery({
      queryKey: ['message', account.email, folder, params.uid],
      queryFn: () => fetchMessage(account, folder, uid),
      staleTime: Infinity,
    })
      .then(({ parsed }) => {
        const from = flattenAddresses(parsed.from);
        const replyTo = flattenAddresses(parsed.replyTo);
        const me = account.email.toLowerCase();
        const date = parsed.date ? Date.parse(parsed.date) : 0;
        const original = parsed.text ?? '';

        if (mode === 'forward') {
          setSubject(/^\s*fwd?:/i.test(parsed.subject ?? '') ? (parsed.subject ?? '') : `Fwd: ${parsed.subject ?? ''}`);
          setBody(`\n\n---------- 転送メッセージ ----------\n差出人: ${joinAddresses(from)}\n件名: ${parsed.subject ?? ''}\n\n${original}`);
          return;
        }
        const primary = replyTo.length ? replyTo : from;
        setTo(joinAddresses(primary));
        if (mode === 'replyAll') {
          const others = [...flattenAddresses(parsed.to), ...flattenAddresses(parsed.cc)].filter(
            (a) => a.address.toLowerCase() !== me && !primary.some((p) => p.address.toLowerCase() === a.address.toLowerCase()),
          );
          setCc(joinAddresses(others));
        }
        setSubject(replySubject(parsed.subject ?? ''));
        setBody(quoteText(original, from[0], date));
        setThreading({ inReplyTo: parsed.messageId, references: buildReferences(parsed.references, parsed.messageId) });
      })
      .catch((e) => Alert.alert('元のメールを読み込めませんでした', e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingOriginal(false));
  }, [mode, params.folder, params.uid, account, qc]);

  const onSend = async () => {
    const toList = parseAddressList(to);
    const ccList = parseAddressList(cc);
    const bccList = parseAddressList(bcc);
    const all = [...toList, ...ccList, ...bccList];
    if (toList.length === 0) return Alert.alert('宛先を入力してください');
    const bad = all.find((a) => !isValidAddress(a.address));
    if (bad) return Alert.alert('メールアドレスが正しくありません', bad.address);
    if (!subject.trim()) {
      const ok = await new Promise<boolean>((resolve) =>
        Alert.alert('件名がありません', '件名なしで送信しますか？', [
          { text: 'キャンセル', style: 'cancel', onPress: () => resolve(false) },
          { text: '送信', onPress: () => resolve(true) },
        ]),
      );
      if (!ok) return;
    }

    setSending(true);
    try {
      await send(account, {
        from: { name: account.displayName, address: account.email },
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject,
        text: body,
        ...threading,
      });
      router.back();
    } catch (e) {
      Alert.alert('送信できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const onCancel = () => {
    if (!body.trim() && !to.trim()) return router.back();
    Alert.alert('下書きを破棄しますか？', undefined, [
      { text: '編集を続ける', style: 'cancel' },
      { text: '破棄', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const title = { new: '新規メッセージ', reply: '返信', replyAll: '全員に返信', forward: '転送' }[mode];

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerLeft: () => (
            <Pressable onPress={onCancel} hitSlop={8}>
              <Text style={{ color: c.primary, fontSize: 16 }}>キャンセル</Text>
            </Pressable>
          ),
          headerRight: () =>
            sending ? (
              <ActivityIndicator />
            ) : (
              <Pressable onPress={onSend} hitSlop={8} disabled={loadingOriginal}>
                <Text style={{ color: c.primary, fontSize: 16, fontWeight: '600' }}>送信</Text>
              </Pressable>
            ),
        }}
      />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: c.background }} keyboardVerticalOffset={100}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
          <HeaderField label="宛先" value={to} onChangeText={setTo} keyboardType="email-address" autoFocus={mode === 'new'} />
          <HeaderField label="Cc" value={cc} onChangeText={setCc} keyboardType="email-address" />
          <HeaderField label="Bcc" value={bcc} onChangeText={setBcc} keyboardType="email-address" />
          <HeaderField label="件名" value={subject} onChangeText={setSubject} autoCapitalize="sentences" />
          {loadingOriginal ? (
            <ActivityIndicator style={{ marginTop: 24 }} />
          ) : (
            <TextInput
              style={[styles.body, { color: c.text }]}
              value={body}
              onChangeText={setBody}
              multiline
              scrollEnabled={false}
              textAlignVertical="top"
              autoFocus={mode === 'reply' || mode === 'replyAll'}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function HeaderField({ label, ...props }: TextInputProps & { label: string }) {
  const c = useColors();
  return (
    <View style={[styles.headerRow, { borderColor: c.separator }]}>
      <Text style={[styles.headerLabel, { color: c.muted }]}>{label}:</Text>
      <TextInput autoCapitalize="none" autoCorrect={false} style={[styles.headerInput, { color: c.text }]} {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16 },
  headerLabel: { fontSize: 16, width: 44 },
  headerInput: { flex: 1, fontSize: 16, paddingVertical: 12 },
  body: { flex: 1, fontSize: 16, lineHeight: 22, padding: 16, minHeight: 300 },
});
