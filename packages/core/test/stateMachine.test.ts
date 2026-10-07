import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FrozenClock } from '@rocan/clock';
import {
  REPORT_EVENT_TYPES,
  REPORT_STATUSES,
  TRANSITIONS,
  TransitionError,
  transition,
  type Actor,
  type FromStatus,
  type ReportEvent,
  type ReportEventType,
  type ReportFlag,
  type ReportStatus,
} from '../src/index';

const clock = new FrozenClock('2026-05-01T12:00:00Z');
const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';

/** A valid payload and actor for every event type. */
function sample(type: ReportEventType): { event: ReportEvent; actor: Actor } {
  const staff: Actor = { type: 'staff', id: 'staff-1' };
  const system: Actor = { type: 'system' };
  switch (type) {
    case 'submit':
      return { event: { type }, actor: { type: 'reporter' } };
    case 'reporter.withdraw':
      return { event: { type }, actor: { type: 'reporter' } };
    case 'ingest.start':
    case 'dispatch.all_primary_sent':
    case 'retention.expire':
      return { event: { type }, actor: system };
    case 'pipeline.reject':
      return { event: { type, reason: 'outside_aruba' }, actor: system };
    case 'pipeline.done':
      return { event: { type, autoDispatch: false }, actor: system };
    case 'moderator.approve':
      return {
        event: { type, finalCategoryCode: 'SEA_TURTLE', severity: 4, redactionsConfirmed: true },
        actor: staff,
      };
    case 'moderator.reject':
      return { event: { type, reason: 'not environmental' }, actor: staff };
    case 'moderator.merge':
      return { event: { type, targetReportId: OTHER }, actor: staff };
    case 'agency.ack':
    case 'agency.in_progress':
      return { event: { type }, actor: staff };
    case 'agency.resolve':
      return { event: { type, outcomeNote: 'site cleaned' }, actor: staff };
    case 'agency.no_action':
      return { event: { type, reason: 'already known' }, actor: staff };
    case 'agency.decline':
      return { event: { type, reason: 'not our competence' }, actor: staff };
  }
}

/** SPEC §8.1, written out independently of the implementation's table. */
const EXPECTED: Record<string, ReportStatus> = {
  'null|submit': 'submitted',
  'submitted|ingest.start': 'processing',
  'processing|pipeline.reject': 'rejected',
  'processing|pipeline.done': 'pending_review',
  'pending_review|moderator.approve': 'approved',
  'pending_review|moderator.reject': 'rejected',
  'pending_review|moderator.merge': 'merged',
  'submitted|reporter.withdraw': 'rejected',
  'processing|reporter.withdraw': 'rejected',
  'pending_review|reporter.withdraw': 'rejected',
  'approved|dispatch.all_primary_sent': 'dispatched',
  'dispatched|agency.ack': 'acknowledged',
  'dispatched|agency.in_progress': 'in_progress',
  'acknowledged|agency.in_progress': 'in_progress',
  'acknowledged|agency.resolve': 'resolved',
  'in_progress|agency.resolve': 'resolved',
  'acknowledged|agency.no_action': 'no_action',
  'in_progress|agency.no_action': 'no_action',
  'approved|agency.decline': 'pending_review',
  'dispatched|agency.decline': 'pending_review',
  'acknowledged|agency.decline': 'pending_review',
  'in_progress|agency.decline': 'pending_review',
  'rejected|retention.expire': 'archived',
  'merged|retention.expire': 'archived',
  'resolved|retention.expire': 'archived',
  'no_action|retention.expire': 'archived',
};

const ALL_FROM: FromStatus[] = [null, ...REPORT_STATUSES];

describe('state machine: exhaustive (state × event)', () => {
  for (const from of ALL_FROM) {
    for (const type of REPORT_EVENT_TYPES) {
      const key = `${from}|${type}`;
      const expected = EXPECTED[key];
      it(`${from ?? '(new)'} --${type}--> ${expected ?? 'throws'}`, () => {
        const { event, actor } = sample(type);
        const run = () => transition({ id: ID, status: from, flags: [] }, event, actor, clock);
        if (expected === undefined) {
          expect(run).toThrowError(TransitionError);
          try {
            run();
          } catch (e) {
            expect((e as TransitionError).code).toBe('invalid_transition');
          }
        } else {
          const result = run();
          expect(result.to).toBe(expected);
          expect(result.history).toMatchObject({ fromStatus: from, toStatus: expected });
          expect(result.history.at.toISOString()).toBe('2026-05-01T12:00:00.000Z');
          expect(result.audit).toMatchObject({ action: `report.${type}`, entityId: ID });
        }
      });
    }
  }

  it('the implementation table and the spec table agree', () => {
    const fromImpl = new Set(
      REPORT_EVENT_TYPES.flatMap((t) => TRANSITIONS[t].map((f) => `${f}|${t}`)),
    );
    expect([...fromImpl].sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});

describe('state machine: properties', () => {
  const arbFrom = fc.constantFrom(...ALL_FROM);
  const arbType = fc.constantFrom(...REPORT_EVENT_TYPES);

  it('never reaches a state outside the enum and never returns to "no report"', () => {
    fc.assert(
      fc.property(arbFrom, arbType, (from, type) => {
        const { event, actor } = sample(type);
        try {
          const r = transition({ id: ID, status: from, flags: [] }, event, actor, clock);
          return REPORT_STATUSES.includes(r.to);
        } catch (e) {
          return e instanceof TransitionError;
        }
      }),
    );
  });

  it('archived is terminal', () => {
    fc.assert(
      fc.property(arbType, (type) => {
        const { event, actor } = sample(type);
        expect(() =>
          transition({ id: ID, status: 'archived', flags: [] }, event, actor, clock),
        ).toThrow(TransitionError);
      }),
    );
  });

  it('every random walk from submit only follows allowed edges and is fully recorded', () => {
    fc.assert(
      fc.property(fc.array(arbType, { maxLength: 30 }), (types) => {
        let status: FromStatus = null;
        const history: ReportStatus[] = [];
        for (const type of ['submit' as const, ...types]) {
          const { event, actor } = sample(type);
          try {
            const r = transition({ id: ID, status, flags: [] }, event, actor, clock);
            expect(EXPECTED[`${status}|${type}`]).toBe(r.to);
            status = r.to;
            history.push(r.to);
          } catch (e) {
            expect(e).toBeInstanceOf(TransitionError);
          }
        }
        expect(history[0]).toBe('submitted');
      }),
    );
  });
});

describe('state machine: guards', () => {
  const pending = (flags: ReportFlag[] = []) => ({
    id: ID,
    status: 'pending_review' as const,
    flags,
  });
  const mod: Actor = { type: 'staff', id: 'mod-1' };

  it('approval of flagged media requires confirmed redactions', () => {
    const event: ReportEvent = {
      type: 'moderator.approve',
      finalCategoryCode: 'ILLEGAL_DUMPING',
      severity: 3,
      redactionsConfirmed: false,
    };
    expect(() => transition(pending(['possible_minor']), event, mod, clock)).toThrow(/redactions/);
    expect(transition(pending(['low_quality']), event, mod, clock).to).toBe('approved');
  });

  it('approval requires a severity of 1–5', () => {
    for (const severity of [0, 6, 2.5]) {
      expect(() =>
        transition(
          pending(),
          {
            type: 'moderator.approve',
            finalCategoryCode: 'OTHER',
            severity,
            redactionsConfirmed: true,
          },
          mod,
          clock,
        ),
      ).toThrow(/severity/);
    }
  });

  it('rejections, closures and declines require a reason', () => {
    expect(() =>
      transition(pending(), { type: 'moderator.reject', reason: '  ' }, mod, clock),
    ).toThrow(/reason/);
    const ack = { id: ID, status: 'acknowledged' as const, flags: [] };
    expect(() => transition(ack, { type: 'agency.resolve', outcomeNote: '' }, mod, clock)).toThrow(
      /outcomeNote/,
    );
    expect(() => transition(ack, { type: 'agency.decline', reason: '' }, mod, clock)).toThrow(
      /reason/,
    );
  });

  it('a report cannot be merged into itself', () => {
    expect(() =>
      transition(pending(), { type: 'moderator.merge', targetReportId: ID }, mod, clock),
    ).toThrow(/itself/);
  });

  it('only allowed actors can trigger an event', () => {
    expect(() =>
      transition({ id: ID, status: null, flags: [] }, { type: 'submit' }, { type: 'staff' }, clock),
    ).toThrow(/may not/);
    expect(() =>
      transition(
        pending(),
        { type: 'moderator.reject', reason: 'x' },
        { type: 'agency_link' },
        clock,
      ),
    ).toThrow(/may not/);
  });
});

describe('state machine: effects and patches', () => {
  it('submit enqueues ingest', () => {
    const r = transition(
      { id: ID, status: null, flags: [] },
      { type: 'submit' },
      { type: 'reporter' },
      clock,
    );
    expect(r.effects).toEqual([{ type: 'enqueue', job: 'report.ingest', data: { reportId: ID } }]);
  });

  it('pipeline.done with autoDispatch approves and marks auto_approved', () => {
    const r = transition(
      { id: ID, status: 'processing', flags: [] },
      { type: 'pipeline.done', autoDispatch: true },
      { type: 'system' },
      clock,
    );
    expect(r.to).toBe('approved');
    expect(r.patch.autoApproved).toBe(true);
    expect(r.effects[0]).toMatchObject({ job: 'dispatch.render' });
  });

  it('moderator approval records moderator, time and final category', () => {
    const r = transition(
      { id: ID, status: 'pending_review', flags: [] },
      {
        type: 'moderator.approve',
        finalCategoryCode: 'SEA_TURTLE',
        severity: 5,
        redactionsConfirmed: false,
      },
      { type: 'staff', id: 'mod-9' },
      clock,
    );
    expect(r.patch).toMatchObject({
      status: 'approved',
      finalCategoryCode: 'SEA_TURTLE',
      severity: 5,
      moderatedBy: 'mod-9',
    });
    expect(r.patch.moderatedAt?.toISOString()).toBe('2026-05-01T12:00:00.000Z');
  });

  it('merge sets duplicate_of; withdraw sets reason; decline notifies moderators', () => {
    const merge = transition(
      { id: ID, status: 'pending_review', flags: [] },
      { type: 'moderator.merge', targetReportId: OTHER },
      { type: 'staff', id: 'm' },
      clock,
    );
    expect(merge.patch.duplicateOf).toBe(OTHER);
    const withdraw = transition(
      { id: ID, status: 'processing', flags: [] },
      { type: 'reporter.withdraw' },
      { type: 'reporter' },
      clock,
    );
    expect(withdraw.patch.rejectionReason).toBe('withdrawn');
    const decline = transition(
      { id: ID, status: 'dispatched', flags: [] },
      { type: 'agency.decline', reason: 'wrong agency' },
      { type: 'agency_link' },
      clock,
    );
    expect(decline.effects[0]).toMatchObject({
      type: 'notify',
      template: 'moderator.dispatch_declined',
    });
  });
});
