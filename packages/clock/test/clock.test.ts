import { describe, expect, it } from 'vitest';
import {
  DAY,
  FrozenClock,
  HOUR,
  OffsetClock,
  RealClock,
  clockFromSetting,
  type Clock,
} from '../src/index';

const fixed = (iso: string): Clock => ({ now: () => new Date(iso) });

describe('FrozenClock', () => {
  it('returns the same instant until advanced', () => {
    const clock = new FrozenClock('2026-03-01T10:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-03-01T10:00:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-03-01T10:00:00.000Z');
  });

  it('advances by whole days across a month boundary', () => {
    const clock = new FrozenClock('2026-01-28T12:00:00Z');
    clock.advance(7 * DAY);
    expect(clock.now().toISOString()).toBe('2026-02-04T12:00:00.000Z');
  });

  it('returns a fresh Date each call so callers cannot mutate the clock', () => {
    const clock = new FrozenClock('2026-03-01T10:00:00Z');
    clock.now().setUTCFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('refuses to move backwards and rejects invalid dates', () => {
    const clock = new FrozenClock('2026-03-01T10:00:00Z');
    expect(() => clock.advance(-1)).toThrow();
    expect(() => new FrozenClock('not a date')).toThrow();
  });

  it('can be set to an arbitrary instant', () => {
    const clock = new FrozenClock('2026-03-01T10:00:00Z');
    clock.set('2026-04-01T10:00:00Z');
    expect(clock.now().toISOString()).toBe('2026-04-01T10:00:00.000Z');
  });
});

describe('OffsetClock', () => {
  it('adds the offset to the base clock', () => {
    const clock = new OffsetClock(3 * DAY + HOUR, fixed('2026-03-01T10:00:00Z'));
    expect(clock.now().toISOString()).toBe('2026-03-04T11:00:00.000Z');
  });

  it('keeps moving with real time', async () => {
    const clock = new OffsetClock(DAY);
    const a = clock.now().getTime();
    await new Promise((r) => setTimeout(r, 15));
    const b = clock.now().getTime();
    expect(b).toBeGreaterThan(a);
    expect(a - new RealClock().now().getTime()).toBeGreaterThan(DAY - 1000);
  });
});

describe('clockFromSetting', () => {
  it('ignores non-real settings outside mock mode', () => {
    const clock = clockFromSetting({ mode: 'frozen', at: '2000-01-01T00:00:00Z' }, false);
    expect(clock).toBeInstanceOf(RealClock);
  });

  it('builds frozen and offset clocks in mock mode', () => {
    expect(clockFromSetting({ mode: 'frozen', at: '2026-01-01T00:00:00Z' }, true)).toBeInstanceOf(
      FrozenClock,
    );
    expect(clockFromSetting({ mode: 'offset', offsetMs: DAY }, true)).toBeInstanceOf(OffsetClock);
    expect(clockFromSetting(undefined, true)).toBeInstanceOf(RealClock);
  });
});
