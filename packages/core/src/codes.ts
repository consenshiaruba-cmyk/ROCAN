// SPEC §7: public tracking code and follow-up secret formats.

import { wordlist } from '@scure/bip39/wordlists/english.js';

/** Crockford base32 (no I, L, O, U). */
export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Source of uniformly random integers in [0, max). Inject crypto in callers, a stub in tests. */
export type RandomInt = (max: number) => number;

/** `RC-XXXX-XXXX`: 40 random bits, not sequential. */
export function generatePublicCode(randomInt: RandomInt): string {
  const chars = Array.from({ length: 8 }, () => CROCKFORD[randomInt(32)]!).join('');
  return `RC-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export const PUBLIC_CODE_RE = /^RC-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Accepts lower case, spaces and the Crockford look-alikes (O→0, I/L→1). */
export function normalizePublicCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const body = raw.startsWith('RC') ? raw.slice(2) : raw;
  if (body.length !== 8) return null;
  const code = `RC-${body.slice(0, 4)}-${body.slice(4)}`;
  return PUBLIC_CODE_RE.test(code) ? code : null;
}

export const SECRET_WORDS = 6;
export const SECRET_WORDLIST: readonly string[] = wordlist;
const WORDSET = new Set(SECRET_WORDLIST);

/**
 * Follow-up secret: 6 words from a 2048-word list (66 bits). Generated on the reporter's
 * device so a lost response (e.g. offline resubmission) never loses it (phase-2 decision 2).
 */
export function generateFollowUpSecret(randomInt: RandomInt): string {
  return Array.from({ length: SECRET_WORDS }, () => SECRET_WORDLIST[randomInt(2048)]!).join(' ');
}

export function normalizeFollowUpSecret(input: string): string | null {
  const words = input
    .toLowerCase()
    .trim()
    .split(/[\s,.-]+/)
    .filter(Boolean);
  if (words.length !== SECRET_WORDS || !words.every((w) => WORDSET.has(w))) return null;
  return words.join(' ');
}

/** Browser and Node both expose WebCrypto as globalThis.crypto. */
export const cryptoRandomInt: RandomInt = (max) => {
  if (max <= 0 || max > 2 ** 16) throw new Error('cryptoRandomInt: max out of range');
  const limit = Math.floor(2 ** 32 / max) * max; // rejection sampling: no modulo bias
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % max;
  }
};
