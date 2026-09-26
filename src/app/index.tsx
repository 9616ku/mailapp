import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Stack, router } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ErrorView, useColors } from '@/components/ui';
import * as cache from '@/db/cache';
import { disconnect, fetchFolders } from '@/mail/service';
import type { Folder, SpecialUse } from '@/mail/types';
import { useAccount } from '@/store/account';

const ICONS: Record<SpecialUse, SFSymbol> = {
  inbox: 'tray',
  sent: 'paperplane',
  drafts: 'doc',
  trash: 'trash',
  junk: 'xmark.bin',
  archive: 'archivebox',
  all: 'tray.2',
  flagged: 'flag',
};

export default function FoldersScreen() {
  const c = useColors();
  const account = useAccount((s) => s.account)!;
  const signOut = useAccount((s) => s.signOut);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['folders', account.email],
    queryFn: () => fetchFolders(account),
  });
  const cached = useQuery({ queryKey: ['folders-cache'], queryFn: cache.loadFolders, staleTime: Infinity });
  const folders = (q.data ?? cached.data ?? []).filter((f) => f.selectable);

  const onSignOut = () =>
    Alert.alert('ログアウト', 'このアカウントを削除しますか？', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: 'ログアウト',
        style: 'destructive',
        onPress: async () => {
          await disconnect().catch(() => undefined);
          await cache.clearAll();
          qc.clear();
          await signOut();
        },
      },
    ]);

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable onPress={onSignOut} hitSlop={8}>
              <Text style={{ color: c.primary, fontSize: 16 }}>ログアウト</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={() => router.push('/compose')} hitSlop={8}>
              <SymbolView name="square.and.pencil" tintColor={c.primary} size={22} />
            </Pressable>
          ),
        }}
      />
      {q.error && folders.length === 0 ? (
        <ErrorView error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          contentInsetAdjustmentBehavior="automatic"
          data={folders}
          keyExtractor={(f) => f.path}
          refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
          ListHeaderComponent={<Text style={[styles.account, { color: c.muted }]}>{account.email}</Text>}
          renderItem={({ item }) => <FolderRow folder={item} />}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.separator }]} />}
        />
      )}
    </>
  );
}

function FolderRow({ folder }: { folder: Folder }) {
  const c = useColors();
  const depth = folder.delimiter ? folder.path.split(folder.delimiter).length - 1 : 0;
  return (
    <Link href={{ pathname: '/folder/[path]', params: { path: folder.path, name: folder.name } }} asChild>
      <Pressable style={({ pressed }) => [styles.row, { paddingLeft: 16 + depth * 16, backgroundColor: pressed ? c.border : c.background }]}>
        <SymbolView name={folder.specialUse ? ICONS[folder.specialUse] : 'folder'} tintColor={c.primary} size={22} />
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          {folder.name}
        </Text>
        <SymbolView name="chevron.right" tintColor={c.muted} size={14} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  account: { paddingHorizontal: 16, paddingVertical: 8, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingRight: 16, gap: 14 },
  name: { flex: 1, fontSize: 17 },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
});
