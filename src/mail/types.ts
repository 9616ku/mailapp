import type { Security } from './transport';

export type ServerConfig = {
  host: string;
  port: number;
  security: Security;
};

export type Account = {
  email: string;
  displayName: string;
  username: string;
  password: string;
  imap: ServerConfig;
  smtp: ServerConfig;
};

export type SpecialUse = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'all' | 'flagged';

export type Folder = {
  /** Raw (modified UTF-7) path, used on the wire. */
  path: string;
  /** Human-readable name of the last path segment. */
  name: string;
  delimiter: string;
  flags: string[];
  specialUse?: SpecialUse;
  selectable: boolean;
};

export type MailboxStatus = {
  exists: number;
  uidValidity: number;
  uidNext: number;
};

export type AddressInfo = { name: string; address: string };

export type MessageSummary = {
  uid: number;
  subject: string;
  from: AddressInfo[];
  to: AddressInfo[];
  cc: AddressInfo[];
  date: number;
  messageId: string;
  seen: boolean;
  flagged: boolean;
  size: number;
};
