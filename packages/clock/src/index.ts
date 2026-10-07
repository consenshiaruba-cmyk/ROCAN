// SPEC §14 / MOCK_TESTING §4: all business logic reads time through a Clock so that
// tests and the mock environment can freeze or shift it. This is the only package
// allowed to call `Date.now()` / `new Date()` without arguments (enforced by ESLint).

export interface Clock {
  now(): Date;
}

export type ClockMode = 'real' | 'offset' | 'frozen';

export type ClockSetting =
  { mode: 'real' } | { mode: 'offset'; offsetMs: number } | { mode: 'frozen'; at: string };

export class RealClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Real time shifted by a fixed offset. Time keeps moving. */
export class OffsetClock implements Clock {
  constructor(
    readonly offsetMs: number,
    private readonly base: Clock = new RealClock(),
  ) {}

  now(): Date {
    return new Date(this.base.now().getTime() + this.offsetMs);
  }
}

/** Time stands still until advanced explicitly. */
export class FrozenClock implements Clock {
  private current: number;

  constructor(at: Date | string) {
    const ms = new Date(at).getTime();
    if (Number.isNaN(ms)) throw new Error(`FrozenClock: invalid date ${String(at)}`);
    this.current = ms;
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    if (ms < 0) throw new Error('FrozenClock: cannot move backwards');
    this.current += ms;
  }

  set(at: Date | string): void {
    const ms = new Date(at).getTime();
    if (Number.isNaN(ms)) throw new Error(`FrozenClock: invalid date ${String(at)}`);
    this.current = ms;
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * Build a clock from a stored setting. Anything other than the real clock is only
 * honoured in mock mode; production always gets real time (SPEC Appendix A).
 */
export function clockFromSetting(setting: ClockSetting | undefined, mockMode: boolean): Clock {
  if (!mockMode || !setting || setting.mode === 'real') return new RealClock();
  if (setting.mode === 'offset') return new OffsetClock(setting.offsetMs);
  return new FrozenClock(setting.at);
}
