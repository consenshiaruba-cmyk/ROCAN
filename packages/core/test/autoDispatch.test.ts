import { describe, expect, it } from 'vitest';
import { BLOCKING_FLAGS, autoDispatchDecision, type AutoDispatchSettings } from '../src/index';

const on: AutoDispatchSettings = { enabled: true, minConfidence: 0.9, allowedCategories: [] };
const clean = {
  aiCategoryCode: 'ILLEGAL_DUMPING' as const,
  aiConfidence: 0.95,
  flags: [],
  descriptionScrubbed: false,
};

describe('autoDispatchDecision (SPEC §3.2)', () => {
  it('auto-dispatches a clean, confident report when the switch is on', () => {
    expect(autoDispatchDecision(clean, on)).toEqual({ auto: true });
  });

  it('never auto-dispatches with the switch off (launch default)', () => {
    expect(autoDispatchDecision(clean, { ...on, enabled: false }).auto).toBe(false);
  });

  it('respects the confidence threshold (inclusive)', () => {
    expect(autoDispatchDecision({ ...clean, aiConfidence: 0.9 }, on).auto).toBe(true);
    expect(autoDispatchDecision({ ...clean, aiConfidence: 0.899 }, on).auto).toBe(false);
  });

  it('OTHER always needs review, even when allow-listed', () => {
    expect(autoDispatchDecision({ ...clean, aiCategoryCode: 'OTHER' }, on).auto).toBe(false);
    expect(
      autoDispatchDecision(
        { ...clean, aiCategoryCode: 'OTHER' },
        { ...on, allowedCategories: ['OTHER'] },
      ).auto,
    ).toBe(false);
  });

  it('applies the allow-list when set', () => {
    const list = { ...on, allowedCategories: ['SEA_TURTLE' as const] };
    expect(autoDispatchDecision(clean, list).auto).toBe(false);
    expect(autoDispatchDecision({ ...clean, aiCategoryCode: 'SEA_TURTLE' }, list).auto).toBe(true);
  });

  it.each(BLOCKING_FLAGS)('flag %s blocks auto-dispatch', (flag) => {
    expect(autoDispatchDecision({ ...clean, flags: [flag] }, on).auto).toBe(false);
  });

  it('blocks when the scrubber changed the description or classification is missing', () => {
    expect(autoDispatchDecision({ ...clean, descriptionScrubbed: true }, on).auto).toBe(false);
    expect(autoDispatchDecision({ ...clean, aiConfidence: null }, on).auto).toBe(false);
  });

  it('lists every reason', () => {
    const d = autoDispatchDecision(
      { ...clean, aiConfidence: 0.5, flags: ['possible_minor'] },
      { ...on, enabled: false },
    );
    expect(d).toEqual({
      auto: false,
      reasons: ['auto-dispatch disabled', 'confidence below threshold', 'flags: possible_minor'],
    });
  });
});
