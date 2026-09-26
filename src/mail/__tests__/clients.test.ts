import '../../polyfills';

import { latin1Decode, utf8Decode, utf8Encode } from '../bytes';
import { ImapClient } from '../imap/client';
import { ByteReader } from '../reader';
import { sendMail } from '../smtp/client';
import type { Transport } from '../transport';

/**
 * A scripted server: each handler sees the client's accumulated output and
 * returns the reply to push once its trigger text has been written.
 */
class FakeTransport implements Transport {
  readonly reader = new ByteReader();
  written = '';
  tlsStarted = false;
  closed = false;

  constructor(private script: [RegExp, string | ((m: RegExpExecArray) => string)][]) {}

  async write(data: Uint8Array | string) {
    this.written += typeof data === 'string' ? data : utf8Decode(data);
    for (;;) {
      const next = this.script[0];
      if (!next) return;
      const m = next[0].exec(this.written);
      if (!m) return;
      this.script.shift();
      this.written = this.written.slice(m.index + m[0].length);
      const reply = typeof next[1] === 'string' ? next[1] : next[1](m);
      this.reader.push(utf8Encode(reply));
    }
  }

  async startTls() {
    this.tlsStarted = true;
  }

  close() {
    this.closed = true;
  }
}

let mockFake: FakeTransport;
jest.mock('../transport', () => ({
  connect: jest.fn(async () => mockFake),
}));

const header = utf8Encode('From: =?UTF-8?B?5bGx55Sw?= <yamada@example.com>\r\nSubject: =?ISO-2022-JP?B?GyRCJDMkcyRLJEEkTxsoQg==?=\r\nDate: Sat, 26 Sep 2026 10:00:00 +0900\r\n\r\n');

describe('ImapClient', () => {
  it('logs in, lists folders and fetches summaries', async () => {
    mockFake = new FakeTransport([
      [/A1 CAPABILITY\r\n/, '* CAPABILITY IMAP4rev1 LITERAL+\r\nA1 OK done\r\n'],
      [/A2 LOGIN "me@example.com" \{6\+\}\r\nパス\r\n/, 'A2 OK logged in\r\n'],
      [/A3 CAPABILITY\r\n/, '* CAPABILITY IMAP4rev1 LITERAL+ SPECIAL-USE\r\nA3 OK\r\n'],
      [
        /A4 LIST "" "\*"\r\n/,
        '* LIST (\\HasNoChildren) "/" "INBOX"\r\n* LIST (\\HasNoChildren \\Sent) "/" "[Gmail]/&kAFP4W4IMH8w4TD8MOs-"\r\n* LIST (\\Noselect) "/" "[Gmail]"\r\nA4 OK\r\n',
      ],
      [/A5 EXAMINE "INBOX"\r\n/, '* 2 EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n* OK [UIDNEXT 11] ok\r\nA5 OK [READ-ONLY]\r\n'],
      [
        /A6 FETCH 1:2 \(UID FLAGS RFC822.SIZE INTERNALDATE BODY.PEEK\[HEADER.FIELDS \(FROM TO CC SUBJECT DATE MESSAGE-ID\)\]\)\r\n/,
        `* 1 FETCH (UID 9 FLAGS (\\Seen) RFC822.SIZE 100 INTERNALDATE "26-Sep-2026 10:00:00 +0900" BODY[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)] {${header.length}}\r\n` +
          latin1Decode(header) +
          ')\r\n* 2 FETCH (UID 10 FLAGS () RFC822.SIZE 50 INTERNALDATE "26-Sep-2026 11:00:00 +0900" BODY[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)] {4}\r\n\r\n\r\n)\r\nA6 OK\r\n',
      ],
      [/A7 LOGOUT\r\n/, '* BYE\r\nA7 OK\r\n'],
    ]);
    mockFake.reader.push(utf8Encode('* OK ready\r\n'));

    const c = await ImapClient.connect({ host: 'h', port: 993, security: 'tls' }, 'me@example.com', 'パス');
    expect(c.hasCapability('SPECIAL-USE')).toBe(true);

    const folders = await c.listFolders();
    expect(folders.map((f) => [f.name, f.specialUse, f.selectable])).toEqual([
      ['受信トレイ', 'inbox', true],
      ['送信済みメール', 'sent', true],
      ['[Gmail]', undefined, false],
    ]);

    const list = await c.fetchSummariesBySeq('INBOX', 1, 2);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ uid: 9, seen: true, subject: 'こんにちは', from: [{ name: '山田', address: 'yamada@example.com' }] });
    expect(list[1]).toMatchObject({ uid: 10, seen: false, subject: '' });

    await c.logout();
    expect(mockFake.closed).toBe(true);
  });

  it('waits for continuation when LITERAL+ is unavailable, and reports login failures', async () => {
    mockFake = new FakeTransport([
      [/A1 CAPABILITY\r\n/, '* CAPABILITY IMAP4rev1\r\nA1 OK\r\n'],
      [/A2 LOGIN "u" \{6\}\r\n/, '+ go ahead\r\n'],
      [/^パス\r\n/, 'A2 NO [AUTHENTICATIONFAILED] Invalid credentials\r\n'],
    ]);
    mockFake.reader.push(utf8Encode('* OK ready\r\n'));
    await expect(ImapClient.connect({ host: 'h', port: 993, security: 'tls' }, 'u', 'パス')).rejects.toThrow('ログインに失敗しました');
    expect(mockFake.closed).toBe(true);
  });
});

describe('sendMail', () => {
  it('does STARTTLS, AUTH PLAIN and dot-stuffed DATA', async () => {
    mockFake = new FakeTransport([
      [/EHLO mailapp.local\r\n/, '250-smtp.example.com\r\n250-STARTTLS\r\n250 SIZE 1000\r\n'],
      [/STARTTLS\r\n/, '220 go\r\n'],
      [/EHLO mailapp.local\r\n/, '250-smtp.example.com\r\n250 AUTH LOGIN PLAIN\r\n'],
      [/AUTH PLAIN AHVzZXIAcGFzcw==\r\n/, '235 ok\r\n'],
      [/MAIL FROM:<a@x.com>\r\n/, '250 ok\r\n'],
      [/RCPT TO:<b@y.com>\r\n/, '250 ok\r\n'],
      [/RCPT TO:<c@z.com>\r\n/, '250 ok\r\n'],
      [/DATA\r\n/, '354 go\r\n'],
      [/Subject: hi\r\n\r\n\.\.dot\r\n\.\r\n/, '250 queued\r\n'],
    ]);
    mockFake.reader.push(utf8Encode('220 hello\r\n'));
    await sendMail(
      { host: 'h', port: 587, security: 'starttls' },
      'user',
      'pass',
      { from: 'a@x.com', recipients: ['b@y.com', 'c@z.com'] },
      utf8Encode('Subject: hi\r\n\r\n.dot\r\n'),
    );
    expect(mockFake.tlsStarted).toBe(true);
    expect(mockFake.closed).toBe(true);
  });

  it('surfaces authentication errors in Japanese', async () => {
    mockFake = new FakeTransport([
      [/EHLO mailapp.local\r\n/, '250 AUTH PLAIN\r\n'],
      [/AUTH PLAIN .*\r\n/, '535 5.7.8 bad credentials\r\n'],
    ]);
    mockFake.reader.push(utf8Encode('220 hello\r\n'));
    await expect(
      sendMail({ host: 'h', port: 465, security: 'tls' }, 'u', 'p', { from: 'a@x.com', recipients: ['b@y.com'] }, utf8Encode('x')),
    ).rejects.toThrow('送信サーバーの認証に失敗しました');
  });
});
