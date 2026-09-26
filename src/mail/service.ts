import * as cache from '@/db/cache';

import { ImapClient, ImapError } from './imap/client';
import { composeMessage, type OutgoingMessage } from './mime/compose';
import { parseMessage, type ParsedMessage } from './mime/parse';
import { sendMail } from './smtp/client';
import type { Account, Folder, MessageSummary } from './types';

export const PAGE_SIZE = 40;

let client: ImapClient | null = null;
let clientKey = '';
let connecting: Promise<ImapClient> | null = null;

const keyOf = (a: Account) => `${a.username}@${a.imap.host}:${a.imap.port}`;

async function getClient(account: Account): Promise<ImapClient> {
  if (client && !client.isClosed && clientKey === keyOf(account)) return client;
  if (!connecting) {
    connecting = ImapClient.connect(account.imap, account.username, account.password)
      .then((c) => {
        client?.close();
        client = c;
        clientKey = keyOf(account);
        return c;
      })
      .finally(() => {
        connecting = null;
      });
  }
  return connecting;
}

/** Runs an IMAP operation, reconnecting once if the connection dropped (e.g. after backgrounding). */
async function withClient<T>(account: Account, fn: (c: ImapClient) => Promise<T>): Promise<T> {
  const c = await getClient(account);
  try {
    return await fn(c);
  } catch (e) {
    if (e instanceof ImapError && !c.isClosed) throw e;
    c.close();
    return fn(await getClient(account));
  }
}

export async function disconnect() {
  const c = client;
  client = null;
  await c?.logout();
}

export async function verifyAccount(account: Account): Promise<void> {
  const c = await ImapClient.connect(account.imap, account.username, account.password);
  await c.logout();
}

export async function fetchFolders(account: Account): Promise<Folder[]> {
  const folders = await withClient(account, (c) => c.listFolders());
  const order: Record<string, number> = { inbox: 0, drafts: 1, sent: 2, archive: 3, all: 4, flagged: 5, junk: 6, trash: 7 };
  folders.sort((a, b) => (order[a.specialUse ?? ''] ?? 50) - (order[b.specialUse ?? ''] ?? 50) || a.path.localeCompare(b.path));
  await cache.saveFolders(folders);
  return folders;
}

export type Page = { messages: MessageSummary[]; nextPage: number | null };

/**
 * Loads one page of the folder, newest first. Page 0 also refreshes
 * UIDVALIDITY and prunes locally cached messages deleted on the server.
 */
export async function fetchPage(account: Account, folder: string, page: number): Promise<Page> {
  return withClient(account, async (c) => {
    const status = await c.select(folder);
    await cache.checkUidValidity(folder, status.uidValidity);
    const to = status.exists - page * PAGE_SIZE;
    const from = to - PAGE_SIZE + 1;
    const list = await c.fetchSummariesBySeq(folder, from, to);
    list.sort((a, b) => b.uid - a.uid);
    await cache.saveSummaries(folder, list);
    if (page === 0 && list.length > 0) {
      await cache.pruneAbove(folder, list[list.length - 1].uid, list.map((m) => m.uid));
    }
    return { messages: list, nextPage: from > 1 ? page + 1 : null };
  });
}

export async function search(account: Account, folder: string, query: string): Promise<MessageSummary[]> {
  try {
    return await withClient(account, async (c) => {
      const uids = await c.search(folder, query);
      const recent = uids.slice(-100);
      const list = await c.fetchSummariesByUid(folder, recent);
      await cache.saveSummaries(folder, list);
      return list.sort((a, b) => b.date - a.date);
    });
  } catch (e) {
    // Some servers reject CHARSET UTF-8 searches; fall back to what's cached.
    if (e instanceof ImapError) return cache.searchLocal(folder, query);
    throw e;
  }
}

export type FullMessage = { summary: MessageSummary | null; parsed: ParsedMessage };

export async function fetchMessage(account: Account, folder: string, uid: number): Promise<FullMessage> {
  let raw = await cache.loadBody(folder, uid);
  if (!raw) {
    raw = await withClient(account, (c) => c.fetchRaw(folder, uid));
    await cache.saveBody(folder, uid, raw);
  }
  const summary = await cache.getSummary(folder, uid);
  if (summary && !summary.seen) {
    withClient(account, (c) => c.setFlag(folder, uid, '\\Seen', true))
      .then(() => cache.markSeenLocal(folder, uid))
      .catch(() => undefined);
  }
  return { summary, parsed: await parseMessage(raw) };
}

const SERVER_SAVES_SENT = ['smtp.gmail.com'];

export async function send(account: Account, msg: OutgoingMessage): Promise<void> {
  const raw = composeMessage(msg);
  const recipients = [...msg.to, ...(msg.cc ?? []), ...(msg.bcc ?? [])].map((a) => a.address);
  await sendMail(account.smtp, account.username, account.password, { from: msg.from.address, recipients }, raw);

  if (SERVER_SAVES_SENT.includes(account.smtp.host)) return;
  try {
    const folders = await cache.loadFolders();
    const sent = folders.find((f) => f.specialUse === 'sent') ?? folders.find((f) => /^(sent|送信済)/i.test(f.name));
    if (sent) await withClient(account, (c) => c.append(sent.path, raw));
  } catch {
    // The mail went out; failing to file a copy in Sent is not worth surfacing as a send failure.
  }
}
