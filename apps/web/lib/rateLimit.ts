// SPEC §5.5: rate limiting that never stores a client address. The key is an HMAC of the
// address with a random salt that lives only in this process's memory and rotates daily;
// all counters are dropped at rotation. Nothing here is persisted or logged.

import { createHmac, randomBytes } from 'node:crypto';
import type { Clock } from '@rocan/clock';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Limit {
  name: string;
  perHour: number;
  perDay?: number;
}

interface Counter {
  hourStart: number;
  hour: number;
  dayStart: number;
  day: number;
}

export class RateLimiter {
  private salt = randomBytes(32);
  private saltSince: number;
  private counters = new Map<string, Counter>();

  constructor(private readonly clock: Clock) {
    this.saltSince = clock.now().getTime();
  }

  private rotateIfDue(now: number): void {
    if (now - this.saltSince >= DAY) {
      this.salt = randomBytes(32);
      this.saltSince = now;
      this.counters.clear();
    }
  }

  /** Opaque, unlinkable-across-days key for a client address. */
  keyFor(address: string): string {
    this.rotateIfDue(this.clock.now().getTime());
    return createHmac('sha256', this.salt).update(address).digest('base64url').slice(0, 22);
  }

  /** Count one hit. Returns false (and does not count) when the limit is reached. */
  consume(limit: Limit, key: string, amount = 1): boolean {
    const now = this.clock.now().getTime();
    this.rotateIfDue(now);
    const id = `${limit.name}:${key}`;
    let c = this.counters.get(id);
    if (!c) {
      c = { hourStart: now, hour: 0, dayStart: now, day: 0 };
      this.counters.set(id, c);
    }
    if (now - c.hourStart >= HOUR) {
      c.hourStart = now;
      c.hour = 0;
    }
    if (now - c.dayStart >= DAY) {
      c.dayStart = now;
      c.day = 0;
    }
    if (c.hour + amount > limit.perHour) return false;
    if (limit.perDay !== undefined && c.day + amount > limit.perDay) return false;
    c.hour += amount;
    c.day += amount;
    return true;
  }

  /** For tests and diagnostics: number of tracked keys (never the keys themselves). */
  get size(): number {
    return this.counters.size;
  }
}

/**
 * The client address used only to derive the rate-limit key. With TRUST_PROXY the first
 * X-Forwarded-For hop (set by our reverse proxy) is used; otherwise every request shares one
 * bucket, which errs towards limiting rather than towards identifying anyone.
 */
export function clientAddress(headers: Headers, trustProxy: boolean): string {
  if (!trustProxy) return 'shared';
  const xff = headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first || headers.get('x-real-ip')?.trim() || 'shared';
}
