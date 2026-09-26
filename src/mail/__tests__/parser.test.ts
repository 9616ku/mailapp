import { utf8Decode, utf8Encode } from '../bytes';
import { decodeMailboxName, encodeMailboxName, fetchAttributes, readResponse, tokenize } from '../imap/parser';
import { ByteReader } from '../reader';

describe('ByteReader', () => {
  it('splits lines across chunks and reads exact byte counts', async () => {
    const r = new ByteReader();
    r.push(utf8Encode('* OK hel'));
    r.push(utf8Encode('lo\r\nabcdef'));
    expect(await r.readLine()).toBe('* OK hello');
    expect(utf8Decode(await r.readBytes(3))).toBe('abc');
    const pending = r.readLine();
    r.push(utf8Encode('\r\n'));
    expect(await pending).toBe('def');
  });

  it('rejects pending reads when the connection fails', async () => {
    const r = new ByteReader();
    const p = r.readLine();
    r.fail(new Error('closed'));
    await expect(p).rejects.toThrow('closed');
  });
});

describe('readResponse / tokenize', () => {
  it('follows literals, including multi-byte content', async () => {
    const r = new ByteReader();
    const body = utf8Encode('Subject: こんにちは\r\n\r\n');
    r.push(utf8Encode(`* 1 FETCH (UID 42 FLAGS (\\Seen) BODY[HEADER.FIELDS (SUBJECT)] {${body.length}}\r\n`));
    r.push(body);
    r.push(utf8Encode(')\r\n'));
    const resp = await readResponse(r);
    const t = tokenize(resp.text, resp.literals);
    expect(t.slice(0, 3)).toEqual(['*', '1', 'FETCH']);
    const attrs = fetchAttributes(t[3] as any);
    expect(attrs.get('UID')).toBe('42');
    expect(attrs.get('FLAGS')).toEqual(['\\Seen']);
    expect(utf8Decode(attrs.get('BODY[HEADER.FIELDS (SUBJECT)]') as Uint8Array)).toContain('こんにちは');
  });

  it('parses LIST responses with quoted strings and NIL', () => {
    expect(tokenize('* LIST (\\HasNoChildren \\Sent) "/" "Sent Items"')).toEqual([
      '*',
      'LIST',
      ['\\HasNoChildren', '\\Sent'],
      '/',
      'Sent Items',
    ]);
    expect(tokenize('* LIST (\\Noselect) NIL "a\\"b"')).toEqual(['*', 'LIST', ['\\Noselect'], null, 'a"b']);
  });
});

describe('modified UTF-7 mailbox names', () => {
  it.each([
    ['INBOX', 'INBOX'],
    ['A&-B', 'A&B'],
    ['[Gmail]/&kAFP4W4IMH8w4TD8MOs-', '[Gmail]/送信済みメール'],
  ])('%s round-trips', (wire, human) => {
    expect(decodeMailboxName(wire)).toBe(human);
    expect(encodeMailboxName(human)).toBe(wire);
  });
});
