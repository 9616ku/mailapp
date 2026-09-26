import { base64Encode, utf8Encode } from '../bytes';
import type { AddressInfo } from '../types';

export type OutgoingMessage = {
  from: AddressInfo;
  to: AddressInfo[];
  cc?: AddressInfo[];
  bcc?: AddressInfo[];
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  date?: Date;
  messageId?: string;
};

const isAscii = (s: string) => /^[\x00-\x7f]*$/.test(s);

/** RFC 2047 B-encoding, split so no multi-byte character straddles two encoded words. */
export function encodeWord(s: string): string {
  if (isAscii(s) && !/[\r\n]/.test(s)) return s;
  const words: string[] = [];
  let chunk = '';
  for (const ch of s) {
    if (utf8Encode(chunk + ch).length > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${base64Encode(utf8Encode(w))}?=`).join('\r\n ');
}

export function formatAddress(a: AddressInfo): string {
  if (!a.name) return `<${a.address}>`;
  if (!isAscii(a.name)) return `${encodeWord(a.name)} <${a.address}>`;
  const needsQuote = /[()<>\[\]:;@\\,."]/.test(a.name);
  const name = needsQuote ? `"${a.name.replace(/(["\\])/g, '\\$1')}"` : a.name;
  return `${name} <${a.address}>`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const tz = sign + pad(Math.floor(Math.abs(off) / 60)) + pad(Math.abs(off) % 60);
  return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())} ${tz}`;
}

export function generateMessageId(fromAddress: string): string {
  const domain = fromAddress.split('@')[1] || 'localhost';
  const rand = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `<${rand}@${domain}>`;
}

function wrapBase64(b64: string): string {
  return b64.replace(/.{1,76}/g, '$&\r\n');
}

/** Builds a complete RFC 5322 message (UTF-8 text/plain, base64 body). */
export function composeMessage(m: OutgoingMessage): Uint8Array {
  const headers: string[] = [];
  headers.push(`From: ${formatAddress(m.from)}`);
  if (m.to.length) headers.push(`To: ${m.to.map(formatAddress).join(',\r\n ')}`);
  if (m.cc?.length) headers.push(`Cc: ${m.cc.map(formatAddress).join(',\r\n ')}`);
  headers.push(`Subject: ${encodeWord(m.subject)}`);
  headers.push(`Date: ${formatDate(m.date ?? new Date())}`);
  headers.push(`Message-ID: ${m.messageId ?? generateMessageId(m.from.address)}`);
  if (m.inReplyTo) headers.push(`In-Reply-To: ${m.inReplyTo}`);
  if (m.references?.length) headers.push(`References: ${m.references.join('\r\n ')}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset=UTF-8');
  headers.push('Content-Transfer-Encoding: base64');

  const body = wrapBase64(base64Encode(utf8Encode(m.text.replace(/\r?\n/g, '\r\n'))));
  return utf8Encode(headers.join('\r\n') + '\r\n\r\n' + body);
}

// --- Reply helpers ---

export function replySubject(subject: string): string {
  return /^\s*re:/i.test(subject) ? subject : `Re: ${subject}`;
}

export function quoteText(original: string, from: AddressInfo | undefined, date: number): string {
  const who = from ? (from.name ? `${from.name} <${from.address}>` : from.address) : '';
  const when = date ? new Date(date).toLocaleString('ja-JP') : '';
  const quoted = original
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
  return `\n\n${when} ${who} wrote:\n${quoted}`;
}

export function buildReferences(references: string | undefined, messageId: string | undefined): string[] {
  const refs: string[] = (references ?? '').match(/<[^>]+>/g) ?? [];
  if (messageId && !refs.includes(messageId)) refs.push(messageId);
  return refs;
}

/** Parses a comma/semicolon separated list like `Taro <taro@example.com>, hanako@example.com`. */
export function parseAddressList(input: string): AddressInfo[] {
  return input
    .split(/[,;、]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(.*)<([^>]+)>$/.exec(s);
      if (m) return { name: m[1].trim().replace(/^"|"$/g, ''), address: m[2].trim() };
      return { name: '', address: s };
    });
}

export function isValidAddress(a: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a);
}
