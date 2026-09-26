import { base64Decode, base64Encode, utf8Decode } from '../bytes';
import type { ByteReader } from '../reader';

/** Atoms and quoted strings are strings, NIL is null, literals are bytes. */
export type ImapValue = string | Uint8Array | null | ImapValue[];

export type RawResponse = {
  /** Protocol text with each literal replaced by LITERAL_MARK. */
  text: string;
  literals: Uint8Array[];
};

export const LITERAL_MARK = '\u0000';

const LITERAL_RE = /\{(\d+)\+?\}$/;

/** Reads one complete server response, following any literals it announces. */
export async function readResponse(reader: ByteReader): Promise<RawResponse> {
  let text = '';
  const literals: Uint8Array[] = [];
  for (;;) {
    const line = await reader.readLine();
    const m = LITERAL_RE.exec(line);
    if (!m) return { text: text + line, literals };
    text += line.slice(0, m.index) + LITERAL_MARK;
    literals.push(await reader.readBytes(Number(m[1])));
  }
}

const ATOM_END = new Set([' ', '(', ')', '"', LITERAL_MARK]);

/** Tokenizes a response (or its tail) into nested IMAP values. */
export function tokenize(text: string, literals: Uint8Array[] = []): ImapValue[] {
  let pos = 0;
  let lit = 0;
  const root: ImapValue[] = [];
  const stack: ImapValue[][] = [root];

  while (pos < text.length) {
    const ch = text[pos];
    const top = stack[stack.length - 1];
    if (ch === ' ') {
      pos++;
    } else if (ch === '(') {
      const list: ImapValue[] = [];
      top.push(list);
      stack.push(list);
      pos++;
    } else if (ch === ')') {
      if (stack.length > 1) stack.pop();
      pos++;
    } else if (ch === '"') {
      let s = '';
      pos++;
      while (pos < text.length && text[pos] !== '"') {
        if (text[pos] === '\\') pos++;
        s += text[pos++];
      }
      pos++;
      // Quoted strings arrive as raw bytes; reinterpret them as UTF-8.
      top.push(latin1ToUtf8(s));
    } else if (ch === LITERAL_MARK) {
      top.push(literals[lit++] ?? new Uint8Array());
      pos++;
    } else {
      const start = pos;
      let depth = 0;
      while (pos < text.length) {
        const c = text[pos];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (depth === 0 && ATOM_END.has(c)) break;
        pos++;
      }
      const atom = text.slice(start, pos);
      top.push(atom.toUpperCase() === 'NIL' ? null : atom);
    }
  }
  return root;
}

function latin1ToUtf8(s: string): string {
  if (!/[\x80-\xff]/.test(s)) return s;
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return utf8Decode(bytes);
}

export function asString(v: ImapValue | undefined): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return utf8Decode(v);
  return '';
}

/** Turns a FETCH attribute list `(UID 5 FLAGS (\Seen) ...)` into a map keyed by upper-case name. */
export function fetchAttributes(list: ImapValue[]): Map<string, ImapValue> {
  const out = new Map<string, ImapValue>();
  for (let i = 0; i + 1 < list.length; i += 2) {
    const key = list[i];
    if (typeof key === 'string') out.set(key.toUpperCase(), list[i + 1]);
  }
  return out;
}

// --- Modified UTF-7 (RFC 3501 §5.1.3) for mailbox names ---

export function decodeMailboxName(name: string): string {
  return name.replace(/&([^-]*)-/g, (_, b64: string) => {
    if (b64 === '') return '&';
    const std = b64.replace(/,/g, '/');
    const bytes = base64Decode(std);
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return s;
  });
}

export function encodeMailboxName(name: string): string {
  let out = '';
  let pending = '';
  const flush = () => {
    if (!pending) return;
    const bytes: number[] = [];
    for (let i = 0; i < pending.length; i++) {
      const c = pending.charCodeAt(i);
      bytes.push(c >> 8, c & 0xff);
    }
    out += '&' + base64Encode(new Uint8Array(bytes)).replace(/=+$/, '').replace(/\//g, ',') + '-';
    pending = '';
  };
  for (const ch of name) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c <= 0x7e) {
      flush();
      out += ch === '&' ? '&-' : ch;
    } else {
      pending += ch;
    }
  }
  flush();
  return out;
}
