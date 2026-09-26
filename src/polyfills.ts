import { TextDecoder as LegacyTextDecoder, TextEncoder as LegacyTextEncoder } from 'text-encoding';

// Hermes' built-in TextDecoder only understands UTF-8, but Japanese mail
// is frequently ISO-2022-JP or Shift_JIS. Swap in a full implementation.
function supportsLegacyCharsets(): boolean {
  try {
    for (const cs of ['iso-2022-jp', 'shift_jis', 'euc-jp', 'windows-1252']) new TextDecoder(cs);
    return true;
  } catch {
    return false;
  }
}

if (typeof TextDecoder === 'undefined' || !supportsLegacyCharsets()) {
  (globalThis as any).TextDecoder = LegacyTextDecoder;
}
if (typeof TextEncoder === 'undefined') {
  (globalThis as any).TextEncoder = LegacyTextEncoder;
}
