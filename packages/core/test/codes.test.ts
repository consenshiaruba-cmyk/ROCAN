import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_CODE_RE,
  SECRET_WORDLIST,
  citizenStatus,
  canReporterWithdraw,
  cryptoRandomInt,
  generateFollowUpSecret,
  generatePublicCode,
  normalizeFollowUpSecret,
  normalizePublicCode,
  REPORT_STATUSES,
} from '../src/index';

describe('public code', () => {
  it('has the RC-XXXX-XXXX Crockford format', () => {
    for (let i = 0; i < 200; i++)
      expect(generatePublicCode(cryptoRandomInt)).toMatch(PUBLIC_CODE_RE);
  });

  it('normalizes what people type', () => {
    expect(normalizePublicCode('rc-7kq2-m9xd')).toBe('RC-7KQ2-M9XD');
    expect(normalizePublicCode(' 7KQ2 M9XD ')).toBe('RC-7KQ2-M9XD');
    expect(normalizePublicCode('RC-OIL2-M9XD')).toBe('RC-0112-M9XD');
    expect(normalizePublicCode('RC-7KQ2-M9X')).toBeNull();
    expect(normalizePublicCode('RC-7KQ2-M9XU')).toBeNull();
  });

  it('round-trips every generated code', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 31 }), { minLength: 8, maxLength: 8 }),
        (digits) => {
          let i = 0;
          const code = generatePublicCode(() => digits[i++]!);
          expect(normalizePublicCode(code)).toBe(code);
        },
      ),
    );
  });
});

describe('follow-up secret', () => {
  it('uses a 2048-word list and six words', () => {
    expect(SECRET_WORDLIST).toHaveLength(2048);
    const s = generateFollowUpSecret(cryptoRandomInt);
    expect(s.split(' ')).toHaveLength(6);
    expect(normalizeFollowUpSecret(s)).toBe(s);
  });

  it('normalizes case and separators, rejects wrong words or counts', () => {
    expect(normalizeFollowUpSecret('Abandon, ABILITY able-about above absent')).toBe(
      'abandon ability able about above absent',
    );
    expect(normalizeFollowUpSecret('abandon ability able about above')).toBeNull();
    expect(normalizeFollowUpSecret('abandon ability able about above zzzz')).toBeNull();
  });

  it('cryptoRandomInt stays in range', () => {
    for (let i = 0; i < 1000; i++) {
      const n = cryptoRandomInt(2048);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(2048);
    }
  });
});

describe('citizen status (SPEC §8.2)', () => {
  it('maps every report status and only allows withdrawal before moderation', () => {
    for (const s of REPORT_STATUSES) expect(citizenStatus(s)).toBeTruthy();
    expect(citizenStatus('pending_review')).toBe('checking');
    expect(citizenStatus('dispatched')).toBe('sent');
    expect(REPORT_STATUSES.filter(canReporterWithdraw)).toEqual([
      'submitted',
      'processing',
      'pending_review',
    ]);
  });
});
