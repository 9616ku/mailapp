import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Centered, ErrorView, formatListDate, useColors } from '@/components/ui';
import * as cache from '@/db/cache';
import { fetchPage, PAGE_SIZE, search } from '@/mail/service';
import type { MessageSummary } from '@/mail/types';
import { useAccount } from '@/store/account';

export default function FolderScreen() {
  const { path, name } = useLocalSearchParams<{ path: string; name?: string }>();
  const c = useColors();
  const account = useAccount((s) => s.account)!;
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query.trim(), 400);

  const cached = useQuery({
    queryKey: ['summaries-cache', path],
    queryFn: () => cache.loadSummaries(path, PAGE_SIZE),
  });

  const pages = useInfiniteQuery({
    queryKey: ['messages', account.email, path],
    queryFn: ({ pageParam }) => fetchPage(account, path, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextPage,
  });

  const results = useQuery({
    queryKey: ['search', account.email, path, debounced],
    queryFn: () => search(account, path, debounced),
    enabled: debounced.length > 0,
  });

  const searching = debounced.length > 0;
  const listed = pages.data ? pages.data.pages.flatMap((p) => p.messages) : (cached.data ?? []);
  const data = searching ? (results.data ?? []) : listed;
  const error = searching ? results.error : pages.data ? null : pages.error;

  return (
    <>
      <Stack.Screen
        options={{
          title: name ?? path,
          headerSearchBarOptions: {
            placeholder: '件名・差出人・宛先で検索',
            onChangeText: (e) => setQuery(e.nativeEvent.text),
            onCancelButtonPress: () => setQuery(''),
          },
          headerRight: () => (
            <Pressable onPress={() => router.push('/compose')} hitSlop={8}>
              <SymbolView name="square.and.pencil" tintColor={c.primary} size={22} />
            </Pressable>
          ),
        }}
      />
      {error && data.length === 0 ? (
        <ErrorView error={error} onRetry={() => (searching ? results.refetch() : pages.refetch())} />
      ) : (
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          data={data}
          keyExtractor={(m) => String(m.uid)}
          renderItem={({ item }) => <MessageRow message={item} folder={path} />}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.separator }]} />}
          refreshControl={
            <RefreshControl refreshing={!searching && pages.isRefetching} onRefresh={() => pages.refetch()} />
          }
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (!searching && pages.hasNextPage && !pages.isFetchingNextPage) pages.fetchNextPage();
          }}
          ListEmptyComponent={
            (searching ? results.isFetching : pages.isFetching) ? (
              <Centered>
                <ActivityIndicator />
              </Centered>
            ) : (
              <Centered>
                <Text style={{ color: c.muted, marginTop: 40 }}>{searching ? '見つかりませんでした' : 'メールはありません'}</Text>
              </Centered>
            )
          }
          ListFooterComponent={pages.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} /> : null}
        />
      )}
    </>
  );
}

const MessageRow = memo(function MessageRow({ message, folder }: { message: MessageSummary; folder: string }) {
  const c = useColors();
  const sender = message.from[0] ? message.from[0].name || message.from[0].address : '(差出人なし)';
  return (
    <Link href={{ pathname: '/message/[uid]', params: { uid: String(message.uid), folder } }} asChild>
      <Pressable style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.border : c.background }]}>
        <View style={[styles.dot, { backgroundColor: message.seen ? 'transparent' : c.unread }]} />
        <View style={{ flex: 1 }}>
          <View style={styles.top}>
            <Text style={[styles.sender, { color: c.text, fontWeight: message.seen ? '400' : '700' }]} numberOfLines={1}>
              {sender}
            </Text>
            <Text style={[styles.date, { color: c.muted }]}>{formatListDate(message.date)}</Text>
          </View>
          <Text style={[styles.subject, { color: c.text }]} numberOfLines={2}>
            {message.flagged ? '🚩 ' : ''}
            {message.subject || '(件名なし)'}
          </Text>
        </View>
      </Pressable>
    </Link>
  );
});

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingVertical: 10, paddingRight: 16 },
  dot: { width: 10, height: 10, borderRadius: 5, marginHorizontal: 10, marginTop: 6 },
  top: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  sender: { flex: 1, fontSize: 16 },
  date: { fontSize: 14 },
  subject: { fontSize: 15, marginTop: 2, lineHeight: 20 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 30 },
});
