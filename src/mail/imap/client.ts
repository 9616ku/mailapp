import { utf8Encode } from '../bytes';
import { flattenAddresses, parseMessage } from '../mime/parse';
import { connect, type Transport } from '../transport';
import type { Folder, MailboxStatus, MessageSummary, ServerConfig, SpecialUse } from '../types';
import {
  asString,
  decodeMailboxName,
  fetchAttributes,
  readResponse,
  tokenize,
  type ImapValue,
  type RawResponse,
} from './parser';

export class ImapError extends Error {}

class Literal {
  constructor(readonly bytes: Uint8Array) {}
}

type Arg = string | Literal;

/** Quotes a string argument, falling back to a literal for non-ASCII or unsafe text. */
export function str(s: string): Arg {
  if (/^[\x20-\x7e]*$/.test(s)) return '"' + s.replace(/(["\\])/g, '\\$1') + '"';
  return new Literal(utf8Encode(s));
}

type Untagged = { text: string; literals: Uint8Array[] };

type CommandResult = { untagged: Untagged[]; status: string };

const HEADER_FIELDS = 'BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)]';

const SPECIAL_USE: Record<string, SpecialUse> = {
  '\\SENT': 'sent',
  '\\DRAFTS': 'drafts',
  '\\TRASH': 'trash',
  '\\JUNK': 'junk',
  '\\ARCHIVE': 'archive',
  '\\ALL': 'all',
  '\\FLAGGED': 'flagged',
};

export class ImapClient {
  private tagCounter = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private capabilities = new Set<string>();
  private selected: string | null = null;
  private closed = false;

  private constructor(private transport: Transport) {}

  static async connect(server: ServerConfig, username: string, password: string): Promise<ImapClient> {
    const transport = await connect(server.host, server.port, server.security);
    const client = new ImapClient(transport);
    try {
      const greeting = await readResponse(transport.reader);
      if (!/^\* (OK|PREAUTH)/i.test(greeting.text)) throw new ImapError(`IMAPサーバーの応答が不正です: ${greeting.text}`);
      await client.refreshCapabilities();
      if (server.security === 'starttls') {
        await client.command(['STARTTLS']);
        await transport.startTls();
        await client.refreshCapabilities();
      }
      await client.command(['LOGIN', str(username), str(password)]);
      await client.refreshCapabilities();
      return client;
    } catch (e) {
      transport.close();
      throw e;
    }
  }

  get isClosed() {
    return this.closed;
  }

  hasCapability(name: string) {
    return this.capabilities.has(name.toUpperCase());
  }

  async logout() {
    try {
      await this.command(['LOGOUT']);
    } catch {
      // Server may close before the tagged OK; nothing to recover.
    } finally {
      this.close();
    }
  }

  close() {
    this.closed = true;
    this.transport.close();
  }

  async listFolders(): Promise<Folder[]> {
    const { untagged } = await this.command(['LIST', '""', '"*"']);
    const folders: Folder[] = [];
    for (const u of untagged) {
      const t = tokenize(u.text, u.literals);
      if (t[0] !== '*' || asString(t[1]).toUpperCase() !== 'LIST') continue;
      const flags = (Array.isArray(t[2]) ? t[2] : []).map((f) => asString(f));
      const delimiter = asString(t[3]);
      const path = asString(t[4]);
      const decoded = decodeMailboxName(path);
      const upperFlags = flags.map((f) => f.toUpperCase());
      let specialUse = upperFlags.map((f) => SPECIAL_USE[f]).find(Boolean);
      if (path.toUpperCase() === 'INBOX') specialUse = 'inbox';
      folders.push({
        path,
        name: path.toUpperCase() === 'INBOX' ? '受信トレイ' : delimiter ? decoded.split(delimiter).pop()! : decoded,
        delimiter,
        flags,
        specialUse,
        selectable: !upperFlags.includes('\\NOSELECT') && !upperFlags.includes('\\NONEXISTENT'),
      });
    }
    return folders;
  }

  async select(path: string): Promise<MailboxStatus> {
    const { untagged } = await this.command(['EXAMINE', str(path)]);
    this.selected = path;
    const status: MailboxStatus = { exists: 0, uidValidity: 0, uidNext: 0 };
    for (const u of untagged) {
      let m: RegExpExecArray | null;
      if ((m = /^\* (\d+) EXISTS/i.exec(u.text))) status.exists = Number(m[1]);
      else if ((m = /\[UIDVALIDITY (\d+)\]/i.exec(u.text))) status.uidValidity = Number(m[1]);
      else if ((m = /\[UIDNEXT (\d+)\]/i.exec(u.text))) status.uidNext = Number(m[1]);
    }
    return status;
  }

  private async ensureSelected(path: string) {
    if (this.selected !== path) return this.select(path);
  }

  /** Fetches summaries by sequence range (newest last), e.g. the last 50 messages. */
  async fetchSummariesBySeq(path: string, from: number, to: number): Promise<MessageSummary[]> {
    await this.ensureSelected(path);
    if (to < 1 || from > to) return [];
    const { untagged } = await this.command(['FETCH', `${Math.max(1, from)}:${to}`, `(UID FLAGS RFC822.SIZE INTERNALDATE ${HEADER_FIELDS})`]);
    return this.parseSummaries(untagged);
  }

  async fetchSummariesByUid(path: string, uids: number[]): Promise<MessageSummary[]> {
    if (uids.length === 0) return [];
    await this.ensureSelected(path);
    const { untagged } = await this.command(['UID FETCH', uids.join(','), `(UID FLAGS RFC822.SIZE INTERNALDATE ${HEADER_FIELDS})`]);
    return this.parseSummaries(untagged);
  }

  /** Searches subject, sender and recipients; returns matching UIDs in ascending order. */
  async search(path: string, query: string): Promise<number[]> {
    await this.ensureSelected(path);
    const q = str(query);
    const criteria: Arg[] = ['OR', 'OR', 'SUBJECT', q, 'FROM', q, 'TO', q];
    const needsCharset = q instanceof Literal;
    const { untagged } = await this.command(['UID SEARCH', ...(needsCharset ? ['CHARSET', 'UTF-8'] : []), ...criteria]);
    const uids: number[] = [];
    for (const u of untagged) {
      const m = /^\* SEARCH(.*)$/i.exec(u.text);
      if (m) uids.push(...m[1].trim().split(/\s+/).filter(Boolean).map(Number));
    }
    return uids.sort((a, b) => a - b);
  }

  async fetchRaw(path: string, uid: number): Promise<Uint8Array> {
    await this.ensureSelected(path);
    const { untagged } = await this.command(['UID FETCH', String(uid), '(UID BODY.PEEK[])']);
    for (const u of untagged) {
      const attrs = this.fetchAttrs(u);
      if (!attrs) continue;
      const body = attrs.get('BODY[]');
      if (body instanceof Uint8Array) return body;
      if (typeof body === 'string') return utf8Encode(body);
    }
    throw new ImapError('メールが見つかりません（削除された可能性があります）');
  }

  /** Adds or removes a flag. Temporarily opens the mailbox read-write. */
  async setFlag(path: string, uid: number, flag: string, on: boolean) {
    await this.command(['SELECT', str(path)]);
    this.selected = null;
    await this.command(['UID STORE', String(uid), on ? '+FLAGS.SILENT' : '-FLAGS.SILENT', `(${flag})`]);
  }

  async append(path: string, raw: Uint8Array, flags: string[] = ['\\Seen']) {
    await this.command(['APPEND', str(path), `(${flags.join(' ')})`, new Literal(raw)]);
  }

  private parseSummaries(untagged: Untagged[]): Promise<MessageSummary[]> {
    return Promise.all(
      untagged.flatMap((u) => {
        const attrs = this.fetchAttrs(u);
        if (!attrs || !attrs.has('UID') || ![...attrs.keys()].some((k) => k.startsWith('BODY[HEADER'))) return [];
        return [this.toSummary(attrs)];
      }),
    );
  }

  private async toSummary(attrs: Map<string, ImapValue>): Promise<MessageSummary> {
    const flags = (Array.isArray(attrs.get('FLAGS')) ? (attrs.get('FLAGS') as ImapValue[]) : []).map((f) => asString(f).toUpperCase());
    let header: ImapValue | undefined;
    for (const [k, v] of attrs) if (k.startsWith('BODY[HEADER')) header = v;
    const headerBytes = header instanceof Uint8Array ? header : utf8Encode(asString(header));
    const parsed = await parseMessage(headerBytes);
    const internal = Date.parse(asString(attrs.get('INTERNALDATE')));
    const hdrDate = parsed.date ? Date.parse(parsed.date) : NaN;
    return {
      uid: Number(asString(attrs.get('UID'))),
      subject: parsed.subject ?? '',
      from: flattenAddresses(parsed.from),
      to: flattenAddresses(parsed.to),
      cc: flattenAddresses(parsed.cc),
      date: Number.isFinite(hdrDate) ? hdrDate : Number.isFinite(internal) ? internal : 0,
      messageId: parsed.messageId ?? '',
      seen: flags.includes('\\SEEN'),
      flagged: flags.includes('\\FLAGGED'),
      size: Number(asString(attrs.get('RFC822.SIZE'))) || 0,
    };
  }

  private fetchAttrs(u: Untagged): Map<string, ImapValue> | null {
    const t = tokenize(u.text, u.literals);
    if (t[0] !== '*' || asString(t[2]).toUpperCase() !== 'FETCH' || !Array.isArray(t[3])) return null;
    return fetchAttributes(t[3]);
  }

  private async refreshCapabilities() {
    const { untagged } = await this.command(['CAPABILITY']);
    for (const u of untagged) {
      const m = /^\* CAPABILITY (.*)$/i.exec(u.text);
      if (m) this.capabilities = new Set(m[1].toUpperCase().split(/\s+/));
    }
  }

  /** Runs one command; commands are serialized over the single connection. */
  command(args: Arg[]): Promise<CommandResult> {
    const run = this.queue.then(() => this.execute(args));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async execute(args: Arg[]): Promise<CommandResult> {
    if (this.closed) throw new ImapError('IMAP接続は閉じられています');
    const tag = `A${++this.tagCounter}`;
    const reader = this.transport.reader;
    const literalPlus = this.hasCapability('LITERAL+');
    const untagged: Untagged[] = [];

    const collect = (r: RawResponse) => {
      if (r.text.startsWith('* ')) untagged.push(r);
    };

    let line = tag;
    for (const a of args) {
      if (a instanceof Literal) {
        line += ` {${a.bytes.length}${literalPlus ? '+' : ''}}\r\n`;
        await this.transport.write(line);
        line = '';
        if (!literalPlus) {
          for (;;) {
            const r = await readResponse(reader);
            if (r.text.startsWith('+')) break;
            if (r.text.startsWith(tag + ' ')) throw new ImapError(r.text.slice(tag.length + 1));
            collect(r);
          }
        }
        await this.transport.write(a.bytes);
      } else {
        line += ' ' + a;
      }
    }
    await this.transport.write(line + '\r\n');

    for (;;) {
      const r = await readResponse(reader);
      if (r.text.startsWith(tag + ' ')) {
        const status = r.text.slice(tag.length + 1);
        if (/^OK/i.test(status)) return { untagged, status };
        if (/^BYE/i.test(status)) this.close();
        throw new ImapError(humanizeImapError(status));
      }
      if (/^\* BYE/i.test(r.text)) this.closed = true;
      collect(r);
    }
  }
}

function humanizeImapError(status: string): string {
  if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(status)) {
    return 'ログインに失敗しました。ユーザー名とパスワード（Gmailの場合はアプリパスワード）を確認してください。';
  }
  return `IMAPエラー: ${status}`;
}
