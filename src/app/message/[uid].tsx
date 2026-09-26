import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Centered, ErrorView, useColors } from '@/components/ui';
import { flattenAddresses } from '@/mail/mime/parse';
import { fetchMessage, type Page } from '@/mail/service';
import type { AddressInfo } from '@/mail/types';
import { useAccount } from '@/store/account';

export default function MessageScreen() {
  const { uid, folder } = useLocalSearchParams<{ uid: string; folder: string }>();
  const c = useColors();
  const account = useAccount((s) => s.account)!;
  const qc = useQueryClient();
  const [showImages, setShowImages] = useState(false);

  const q = useQuery({
    queryKey: ['message', account.email, folder, uid],
    queryFn: () => fetchMessage(account, folder, Number(uid)),
    staleTime: Infinity,
  });

  // Reflect the read state in the list without refetching it.
  useEffect(() => {
    if (!q.data) return;
    qc.setQueryData<InfiniteData<Page>>(['messages', account.email, folder], (old) =>
      old && {
        ...old,
        pages: old.pages.map((p) => ({ ...p, messages: p.messages.map((m) => (m.uid === Number(uid) ? { ...m, seen: true } : m)) })),
      },
    );
  }, [q.data, qc, account.email, folder, uid]);

  const reply = (mode: 'reply' | 'replyAll' | 'forward') =>
    router.push({ pathname: '/compose', params: { mode, folder, uid } });

  const onReplyMenu = () =>
    ActionSheetIOS.showActionSheetWithOptions({ options: ['返信', '全員に返信', '転送', 'キャンセル'], cancelButtonIndex: 3 }, (i) => {
      if (i === 0) reply('reply');
      else if (i === 1) reply('replyAll');
      else if (i === 2) reply('forward');
    });

  if (q.isPending) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }
  if (q.error) return <ErrorView error={q.error} onRetry={() => q.refetch()} />;

  const { parsed } = q.data;
  const from = flattenAddresses(parsed.from);
  const to = flattenAddresses(parsed.to);
  const cc = flattenAddresses(parsed.cc);
  const date = parsed.date ? new Date(parsed.date) : null;
  const hasRemoteImages = !!parsed.html && /<img[^>]+src=["']?https?:/i.test(parsed.html);
  const attachments = parsed.attachments.filter((a) => a.disposition !== 'inline' || !a.contentId);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={onReplyMenu} hitSlop={8}>
              <SymbolView name="arrowshape.turn.up.left" tintColor={c.primary} size={22} />
            </Pressable>
          ),
        }}
      />
      <View style={{ flex: 1, backgroundColor: c.background }}>
        <View style={[styles.header, { borderColor: c.separator }]}>
          <Text style={[styles.subject, { color: c.text }]} selectable>
            {parsed.subject || '(件名なし)'}
          </Text>
          <AddressLine label="差出人" list={from} />
          <AddressLine label="宛先" list={to} />
          {cc.length > 0 && <AddressLine label="Cc" list={cc} />}
          {date && <Text style={[styles.meta, { color: c.muted }]}>{date.toLocaleString('ja-JP')}</Text>}
          {attachments.length > 0 && (
            <Text style={[styles.meta, { color: c.muted }]} numberOfLines={2}>
              📎 {attachments.map((a) => a.filename ?? '名称未設定').join(', ')}
            </Text>
          )}
          {hasRemoteImages && !showImages && (
            <Pressable onPress={() => setShowImages(true)}>
              <Text style={[styles.meta, { color: c.primary }]}>外部の画像を表示</Text>
            </Pressable>
          )}
        </View>
        {parsed.html ? (
          <WebView
            originWhitelist={['*']}
            source={{ html: wrapHtml(parsed.html, showImages, c.dark) }}
            javaScriptEnabled={false}
            style={{ flex: 1, backgroundColor: c.background }}
            onShouldStartLoadWithRequest={(req) => {
              if (req.url === 'about:blank' || req.url.startsWith('data:')) return true;
              Linking.openURL(req.url);
              return false;
            }}
          />
        ) : (
          <ScrollView contentContainerStyle={styles.textBody}>
            <Text style={[styles.text, { color: c.text }]} selectable>
              {parsed.text ?? ''}
            </Text>
          </ScrollView>
        )}
      </View>
    </>
  );
}

function AddressLine({ label, list }: { label: string; list: AddressInfo[] }) {
  const c = useColors();
  if (list.length === 0) return null;
  return (
    <Text style={[styles.meta, { color: c.muted }]} numberOfLines={2}>
      {label}: <Text style={{ color: c.text }}>{list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ')}</Text>
    </Text>
  );
}

/** Sandboxes the HTML body: no scripts, and remote images only after the user opts in. */
function wrapHtml(html: string, allowRemote: boolean, dark: boolean): string {
  const img = allowRemote ? "img-src * data: cid:;" : 'img-src data: cid:;';
  const csp = `default-src 'none'; style-src 'unsafe-inline' *; ${img} font-src * data:;`;
  return `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: -apple-system-body; margin: 12px 16px; word-wrap: break-word; ${dark ? 'color-scheme: dark;' : ''} }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
</style></head><body>${html}</body></html>`;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  subject: { fontSize: 20, fontWeight: '600', marginBottom: 6 },
  meta: { fontSize: 14 },
  textBody: { padding: 16 },
  text: { fontSize: 16, lineHeight: 23 },
});
