import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AREA_KINDS,
  CATEGORY_CODES,
  RoutingRuleSchema,
  route,
  type AgencyRef,
  type AreaRef,
  type RoutingRule,
} from '../src/index';

const agencies: AgencyRef[] = [
  { code: 'DNM', receivesIncidents: true },
  { code: 'ACF', receivesIncidents: true },
  { code: 'DOW', receivesIncidents: true },
  { code: 'OM', receivesIncidents: false },
];

const rule = (r: Partial<RoutingRule> & Pick<RoutingRule, 'id' | 'agency' | 'role'>): RoutingRule =>
  RoutingRuleSchema.parse({ priority: 1, category: '*', when: {}, active: true, ...r });

const arikok: AreaRef = { code: 'ARIKOK_NP', kind: 'national_park', managedBy: 'ACF' };

describe('route()', () => {
  it('primary beats cc for the same agency and keeps every contributing rule', () => {
    const rules = [
      rule({ id: 'a', priority: 1, agency: 'DNM', role: 'cc' }),
      rule({ id: 'b', priority: 2, agency: 'DNM', role: 'primary' }),
    ];
    const r = route({ categoryCode: 'OTHER', areas: [], isMarine: false }, rules, agencies);
    expect(r.dispatches).toEqual([
      { agency: 'DNM', role: 'primary', ruleIds: ['a', 'b'], reasons: ['rule a', 'rule b'] },
    ]);
    expect(r.flags).toEqual([]);
  });

  it('never routes incidents to the OM', () => {
    const rules = [
      rule({ id: 'om', agency: 'OM', role: 'primary' }),
      rule({ id: 'dnm', agency: 'DNM', role: 'primary' }),
    ];
    const r = route({ categoryCode: 'SEA_TURTLE', areas: [], isMarine: true }, rules, agencies);
    expect(r.dispatches.map((d) => d.agency)).toEqual(['DNM']);
  });

  it('falls back to DNM primary with a flag when no primary matches', () => {
    const rules = [rule({ id: 'x', agency: 'ACF', role: 'cc', when: { is_marine: true } })];
    const r = route({ categoryCode: 'OTHER', areas: [], isMarine: true }, rules, agencies);
    expect(r.flags).toEqual(['routing_fallback']);
    expect(r.dispatches.map((d) => [d.agency, d.role])).toEqual([
      ['DNM', 'primary'],
      ['ACF', 'cc'],
    ]);
  });

  it('upgrades an existing DNM cc to primary on fallback', () => {
    const rules = [rule({ id: 'x', agency: 'DNM', role: 'cc' })];
    const r = route({ categoryCode: 'OTHER', areas: [], isMarine: false }, rules, agencies);
    expect(r.dispatches).toHaveLength(1);
    expect(r.dispatches[0]).toMatchObject({ agency: 'DNM', role: 'primary' });
  });

  it('evaluates every condition key', () => {
    const r = (
      when: RoutingRule['when'],
      areas: AreaRef[],
      isMarine = false,
      category: RoutingRule['category'] = '*',
    ) =>
      route(
        { categoryCode: 'CORAL_REEF_DAMAGE', areas, isMarine },
        [rule({ id: 'c', agency: 'DOW', role: 'primary', when, category })],
        agencies,
      ).flags.length === 0;
    expect(r({ in_area_managed_by: 'ACF' }, [arikok])).toBe(true);
    expect(r({ in_area_managed_by: 'ACF' }, [])).toBe(false);
    expect(r({ not_in_area_managed_by: 'ACF' }, [arikok])).toBe(false);
    expect(r({ in_area_kind: ['ramsar'] }, [arikok])).toBe(false);
    expect(r({ in_area_kind: ['ramsar', 'national_park'] }, [arikok])).toBe(true);
    expect(r({ is_marine: true }, [], true)).toBe(true);
    expect(r({ is_marine: true }, [], false)).toBe(false);
    expect(r({ outside_protected_area: true }, [])).toBe(true);
    expect(r({ outside_protected_area: true }, [arikok])).toBe(false);
    expect(r({}, [], false, 'SEA_TURTLE')).toBe(false);
    expect(r({}, [], false, 'CORAL_REEF_DAMAGE')).toBe(true);
  });

  it('ignores inactive rules', () => {
    const rules = [rule({ id: 'off', agency: 'DOW', role: 'primary', active: false })];
    const r = route({ categoryCode: 'OTHER', areas: [], isMarine: false }, rules, agencies);
    expect(r.dispatches.map((d) => d.agency)).toEqual(['DNM']);
  });

  it('rejects unknown condition keys (typos in config fail loudly)', () => {
    expect(() =>
      RoutingRuleSchema.parse({
        id: 'x',
        priority: 1,
        category: '*',
        when: { in_area_managd_by: 'ACF' },
        agency: 'DNM',
        role: 'primary',
      }),
    ).toThrow();
  });

  it('invariants hold for random inputs: exactly one entry per agency, ≥1 primary, no OM', () => {
    const arbRule = fc.record({
      id: fc.string({ minLength: 1, maxLength: 4 }),
      priority: fc.integer({ min: 0, max: 100 }),
      category: fc.constantFrom('*' as const, ...CATEGORY_CODES),
      when: fc.record(
        {
          in_area_managed_by: fc.constantFrom('ACF' as const, 'DNM' as const),
          is_marine: fc.boolean(),
          outside_protected_area: fc.boolean(),
        },
        { requiredKeys: [] },
      ),
      agency: fc.constantFrom('DNM' as const, 'ACF' as const, 'DOW' as const, 'OM' as const),
      role: fc.constantFrom('primary' as const, 'cc' as const),
      active: fc.boolean(),
    });
    const arbArea = fc.record({
      code: fc.string(),
      kind: fc.constantFrom(...AREA_KINDS),
      managedBy: fc.constantFrom('ACF' as const, 'DNM' as const, null),
    });
    fc.assert(
      fc.property(
        fc.array(arbRule, { maxLength: 12 }),
        fc.array(arbArea, { maxLength: 3 }),
        fc.boolean(),
        fc.constantFrom(...CATEGORY_CODES),
        (rules, areas, isMarine, categoryCode) => {
          const r = route({ categoryCode, areas, isMarine }, rules, agencies);
          const codes = r.dispatches.map((d) => d.agency);
          expect(new Set(codes).size).toBe(codes.length);
          expect(codes).not.toContain('OM');
          expect(r.dispatches.some((d) => d.role === 'primary')).toBe(true);
          expect(r.dispatches[0]?.role).toBe('primary');
        },
      ),
    );
  });
});
