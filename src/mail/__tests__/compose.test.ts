import { latin1Decode, utf8Decode } from '../bytes';
import {
  buildReferences,
  composeMessage,
  encodeWord,
  formatAddress,
  parseAddressList,
  replySubject,
} from '../mime/compose';
import { parseMessage } from '../mime/parse';
import { dotStuff } from '../smtp/client';

jest.mock('../transport', () => ({ connect: jest.fn() }));

describe('composeMessage', () => {
  const raw = composeMessage({
    from: { name: '山田 太郎', address: 'taro@example.com' },
    to: [{ name: 'Hanako, Sato', address: 'hanako@example.jp' }],
    cc: [{ name: '', address: 'cc@example.com' }],
    subject: 'お打ち合わせの件について、来週のご都合はいかがでしょうか',
    text: '本文です。\n.先頭がドットの行\n',
    inReplyTo: '<orig@example.com>',
    references: ['<a@x>', '<orig@example.com>'],
    date: new Date('2026-09-26T10:00:00Z'),
    messageId: '<fixed@example.com>',
  });

  it('is pure ASCII on the wire with short lines', () => {
    const text = latin1Decode(raw);
    expect(/^[\x00-\x7f]*$/.test(text)).toBe(true);
    for (const line of text.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998);
  });

  it('round-trips through the MIME parser', async () => {
    const p = await parseMessage(raw);
    expect(p.subject).toBe('お打ち合わせの件について、来週のご都合はいかがでしょうか');
    expect(p.from).toEqual({ name: '山田 太郎', address: 'taro@example.com' });
    expect(p.to).toEqual([{ name: 'Hanako, Sato', address: 'hanako@example.jp' }]);
    expect(p.text?.replace(/\r\n/g, '\n')).toBe('本文です。\n.先頭がドットの行\n');
    expect(p.inReplyTo).toBe('<orig@example.com>');
    expect(p.messageId).toBe('<fixed@example.com>');
  });
});

describe('header helpers', () => {
  it('leaves ASCII alone and splits long UTF-8 into encoded words', () => {
    expect(encodeWord('Hello')).toBe('Hello');
    const enc = encodeWord('あ'.repeat(40));
    expect(enc.split('\r\n ').length).toBeGreaterThan(1);
    expect(enc).toMatch(/^=\?UTF-8\?B\?/);
  });

  it('quotes display names with specials', () => {
    expect(formatAddress({ name: 'Doe, John', address: 'j@x.com' })).toBe('"Doe, John" <j@x.com>');
    expect(formatAddress({ name: '', address: 'j@x.com' })).toBe('<j@x.com>');
  });

  it('parses address lists', () => {
    expect(parseAddressList('Taro <t@x.com>, h@y.jp、 "Q" <q@z.com>')).toEqual([
      { name: 'Taro', address: 't@x.com' },
      { name: '', address: 'h@y.jp' },
      { name: 'Q', address: 'q@z.com' },
    ]);
  });

  it('builds reply subject and references', () => {
    expect(replySubject('Hello')).toBe('Re: Hello');
    expect(replySubject('RE: Hello')).toBe('RE: Hello');
    expect(buildReferences('<a@x> <b@x>', '<c@x>')).toEqual(['<a@x>', '<b@x>', '<c@x>']);
    expect(buildReferences(undefined, '<c@x>')).toEqual(['<c@x>']);
  });
});

describe('dotStuff', () => {
  it('escapes leading dots and appends the terminator', () => {
    const out = utf8Decode(dotStuff(new TextEncoder().encode('a\r\n.b\r\n')));
    expect(out).toBe('a\r\n..b\r\n.\r\n');
  });
});
