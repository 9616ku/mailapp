import PostalMime, { type Address, type Email } from 'postal-mime';

import type { AddressInfo } from '../types';

export type ParsedMessage = Email;

export function parseMessage(raw: Uint8Array): Promise<ParsedMessage> {
  return PostalMime.parse(raw, { attachmentEncoding: 'arraybuffer' });
}

export function flattenAddresses(list: Address[] | Address | undefined): AddressInfo[] {
  if (!list) return [];
  const out: AddressInfo[] = [];
  for (const a of Array.isArray(list) ? list : [list]) {
    if ('group' in a && a.group) out.push(...flattenAddresses(a.group));
    else if (a.address) out.push({ name: a.name ?? '', address: a.address });
  }
  return out;
}
