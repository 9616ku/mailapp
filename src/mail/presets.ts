import type { ServerConfig } from './types';

export type Preset = {
  id: string;
  label: string;
  domains: string[];
  imap: ServerConfig;
  smtp: ServerConfig;
  note?: string;
};

export const PRESETS: Preset[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    domains: ['gmail.com', 'googlemail.com'],
    imap: { host: 'imap.gmail.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.gmail.com', port: 465, security: 'tls' },
    note: '2段階認証を有効にして「アプリパスワード」を発行し、それをパスワード欄に入力してください。',
  },
  {
    id: 'icloud',
    label: 'iCloud',
    domains: ['icloud.com', 'me.com', 'mac.com'],
    imap: { host: 'imap.mail.me.com', port: 993, security: 'tls' },
    smtp: { host: 'smtp.mail.me.com', port: 587, security: 'starttls' },
    note: 'Apple IDの設定で「App用パスワード」を発行して入力してください。',
  },
  {
    id: 'yahoojp',
    label: 'Yahoo!メール',
    domains: ['yahoo.co.jp', 'ymail.ne.jp'],
    imap: { host: 'imap.mail.yahoo.co.jp', port: 993, security: 'tls' },
    smtp: { host: 'smtp.mail.yahoo.co.jp', port: 465, security: 'tls' },
    note: 'Yahoo!メールの設定で「IMAP/POP/SMTPアクセス」を有効にしてください。',
  },
];

export function presetForEmail(email: string): Preset | undefined {
  const domain = email.split('@')[1]?.toLowerCase();
  return PRESETS.find((p) => domain && p.domains.includes(domain));
}
