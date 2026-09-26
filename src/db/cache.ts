import * as SQLite from 'expo-sqlite';

import type { Folder, MessageSummary } from '@/mail/types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const d = await SQLite.openDatabaseAsync('mailcache.db');
      await d.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS folders (path TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, position INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS folder_meta (path TEXT PRIMARY KEY NOT NULL, uid_validity INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS messages (
          folder TEXT NOT NULL, uid INTEGER NOT NULL, date INTEGER NOT NULL,
          subject TEXT NOT NULL, sender TEXT NOT NULL, json TEXT NOT NULL,
          PRIMARY KEY (folder, uid)
        );
        CREATE INDEX IF NOT EXISTS messages_by_date ON messages (folder, date DESC);
        CREATE TABLE IF NOT EXISTS bodies (folder TEXT NOT NULL, uid INTEGER NOT NULL, raw BLOB NOT NULL, PRIMARY KEY (folder, uid));
      `);
      return d;
    })();
  }
  return dbPromise;
}

export async function saveFolders(folders: Folder[]) {
  const d = await db();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM folders');
    for (const [i, f] of folders.entries()) {
      await d.runAsync('INSERT INTO folders (path, json, position) VALUES (?, ?, ?)', f.path, JSON.stringify(f), i);
    }
  });
}

export async function loadFolders(): Promise<Folder[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ json: string }>('SELECT json FROM folders ORDER BY position');
  return rows.map((r) => JSON.parse(r.json));
}

/** Drops cached messages when the server's UIDVALIDITY changed (UIDs are no longer meaningful). */
export async function checkUidValidity(folder: string, uidValidity: number) {
  const d = await db();
  const row = await d.getFirstAsync<{ uid_validity: number }>('SELECT uid_validity FROM folder_meta WHERE path = ?', folder);
  if (row && row.uid_validity === uidValidity) return;
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM messages WHERE folder = ?', folder);
    await d.runAsync('DELETE FROM bodies WHERE folder = ?', folder);
    await d.runAsync('INSERT OR REPLACE INTO folder_meta (path, uid_validity) VALUES (?, ?)', folder, uidValidity);
  });
}

export async function saveSummaries(folder: string, list: MessageSummary[]) {
  if (list.length === 0) return;
  const d = await db();
  await d.withTransactionAsync(async () => {
    for (const m of list) {
      const sender = m.from.map((a) => `${a.name} ${a.address}`).join(' ');
      await d.runAsync(
        'INSERT OR REPLACE INTO messages (folder, uid, date, subject, sender, json) VALUES (?, ?, ?, ?, ?, ?)',
        folder,
        m.uid,
        m.date,
        m.subject,
        sender,
        JSON.stringify(m),
      );
    }
  });
}

/** Keeps only the given UIDs in [minUid, ∞) so messages deleted on the server disappear locally. */
export async function pruneAbove(folder: string, minUid: number, keep: number[]) {
  const d = await db();
  const placeholders = keep.map(() => '?').join(',') || 'NULL';
  await d.runAsync(`DELETE FROM messages WHERE folder = ? AND uid >= ? AND uid NOT IN (${placeholders})`, folder, minUid, ...keep);
}

export async function loadSummaries(folder: string, limit: number): Promise<MessageSummary[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ json: string }>(
    'SELECT json FROM messages WHERE folder = ? ORDER BY date DESC LIMIT ?',
    folder,
    limit,
  );
  return rows.map((r) => JSON.parse(r.json));
}

export async function getSummary(folder: string, uid: number): Promise<MessageSummary | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ json: string }>('SELECT json FROM messages WHERE folder = ? AND uid = ?', folder, uid);
  return row ? JSON.parse(row.json) : null;
}

export async function searchLocal(folder: string, query: string, limit = 100): Promise<MessageSummary[]> {
  const d = await db();
  const like = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
  const rows = await d.getAllAsync<{ json: string }>(
    "SELECT json FROM messages WHERE folder = ? AND (subject LIKE ? ESCAPE '\\' OR sender LIKE ? ESCAPE '\\') ORDER BY date DESC LIMIT ?",
    folder,
    like,
    like,
    limit,
  );
  return rows.map((r) => JSON.parse(r.json));
}

export async function saveBody(folder: string, uid: number, raw: Uint8Array) {
  const d = await db();
  await d.runAsync('INSERT OR REPLACE INTO bodies (folder, uid, raw) VALUES (?, ?, ?)', folder, uid, raw);
}

export async function loadBody(folder: string, uid: number): Promise<Uint8Array | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ raw: Uint8Array }>('SELECT raw FROM bodies WHERE folder = ? AND uid = ?', folder, uid);
  return row ? new Uint8Array(row.raw) : null;
}

export async function markSeenLocal(folder: string, uid: number) {
  const m = await getSummary(folder, uid);
  if (m && !m.seen) await saveSummaries(folder, [{ ...m, seen: true }]);
}

export async function clearAll() {
  const d = await db();
  await d.execAsync('DELETE FROM folders; DELETE FROM folder_meta; DELETE FROM messages; DELETE FROM bodies;');
}
