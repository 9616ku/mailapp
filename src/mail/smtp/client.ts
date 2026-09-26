import { base64Encode, concatBytes, utf8Encode } from '../bytes';
import type { ByteReader } from '../reader';
import { connect, type Transport } from '../transport';
import type { ServerConfig } from '../types';

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

type Reply = { code: number; lines: string[] };

export async function readReply(reader: ByteReader): Promise<Reply> {
  const lines: string[] = [];
  for (;;) {
    const line = await reader.readLine();
    const m = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!m) throw new SmtpError(`SMTPサーバーの応答が不正です: ${line}`, 0);
    lines.push(m[3]);
    if (m[2] === ' ') return { code: Number(m[1]), lines };
  }
}

/** Escapes lines starting with "." and terminates the DATA section. */
export function dotStuff(raw: Uint8Array): Uint8Array {
  const out: number[] = [];
  let lineStart = true;
  for (const b of raw) {
    if (lineStart && b === 0x2e) out.push(0x2e);
    out.push(b);
    lineStart = b === 0x0a;
  }
  const tail = raw.length >= 2 && raw[raw.length - 2] === 13 && raw[raw.length - 1] === 10 ? '' : '\r\n';
  return concatBytes([new Uint8Array(out), utf8Encode(`${tail}.\r\n`)]);
}

export type Envelope = { from: string; recipients: string[] };

export async function sendMail(
  server: ServerConfig,
  username: string,
  password: string,
  envelope: Envelope,
  raw: Uint8Array,
): Promise<void> {
  const t = await connect(server.host, server.port, server.security);
  try {
    await session(t, server, username, password, envelope, raw);
  } finally {
    t.close();
  }
}

async function session(t: Transport, server: ServerConfig, username: string, password: string, env: Envelope, raw: Uint8Array) {
  const expect = async (codes: number[]) => {
    const r = await readReply(t.reader);
    if (!codes.includes(r.code)) throw new SmtpError(humanizeSmtpError(r), r.code);
    return r;
  };
  const cmd = async (line: string, codes: number[]) => {
    await t.write(line + '\r\n');
    return expect(codes);
  };

  await expect([220]);
  let ehlo = await cmd('EHLO mailapp.local', [250]);
  if (server.security === 'starttls') {
    await cmd('STARTTLS', [220]);
    await t.startTls();
    ehlo = await cmd('EHLO mailapp.local', [250]);
  }

  const authLine = ehlo.lines.find((l) => /^AUTH[ =]/i.test(l)) ?? '';
  if (/\bPLAIN\b/i.test(authLine) || !/\bLOGIN\b/i.test(authLine)) {
    await cmd(`AUTH PLAIN ${base64Encode(utf8Encode(`\0${username}\0${password}`))}`, [235]);
  } else {
    await cmd('AUTH LOGIN', [334]);
    await cmd(base64Encode(utf8Encode(username)), [334]);
    await cmd(base64Encode(utf8Encode(password)), [235]);
  }

  await cmd(`MAIL FROM:<${env.from}>`, [250]);
  for (const r of env.recipients) await cmd(`RCPT TO:<${r}>`, [250, 251]);
  await cmd('DATA', [354]);
  await t.write(dotStuff(raw));
  await expect([250]);
  await t.write('QUIT\r\n').catch(() => undefined);
}

function humanizeSmtpError(r: Reply): string {
  const text = r.lines.join(' ');
  if (r.code === 535 || r.code === 534) {
    return '送信サーバーの認証に失敗しました。ユーザー名とパスワード（Gmailの場合はアプリパスワード）を確認してください。';
  }
  return `SMTPエラー ${r.code}: ${text}`;
}
