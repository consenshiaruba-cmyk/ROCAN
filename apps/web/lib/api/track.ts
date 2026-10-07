// POST /api/v1/track and /api/v1/track/withdraw (SPEC §5.1, §8.2). Wrong code and wrong secret
// give the same answer after the same amount of work, so neither can be probed.

import {
  TrackSchema,
  canReporterWithdraw,
  citizenStatus,
  normalizeFollowUpSecret,
  type CitizenStatus,
} from '@rocan/core';
import { findForTracking, transitionReport, type TrackingView } from '@rocan/db';
import { clientAddress } from '../rateLimit';
import { error, guarded, issues, json, readJson, type ApiDeps } from './deps';

// Valid argon2id hash of a random string: verified against when the code is unknown.
let dummyHash: Promise<string> | null = null;

async function authenticate(
  req: Request,
  deps: ApiDeps,
): Promise<{ view: TrackingView } | { response: Response }> {
  const parsed = TrackSchema.safeParse(await readJson(req));
  if (!parsed.success) return { response: error(400, 'invalid_request', issues(parsed.error)) };
  const key = deps.limiter.keyFor(clientAddress(req.headers, deps.env.TRUST_PROXY));
  if (!deps.limiter.consume({ name: 'track', perHour: deps.env.RATE_LIMIT_TRACK_PER_HOUR }, key)) {
    return { response: error(429, 'rate_limited') };
  }
  const secret = normalizeFollowUpSecret(parsed.data.secret) ?? parsed.data.secret;
  const view = await findForTracking(deps.sql, parsed.data.code);
  dummyHash ??= deps.secrets.hash(`dummy-${Math.random()}`);
  const ok = await deps.secrets.verify(view?.secretHash ?? (await dummyHash), secret);
  if (!view || !ok) return { response: error(404, 'not_found') };
  return { view };
}

function timeline(view: TrackingView): { status: CitizenStatus; at: string }[] {
  const out: { status: CitizenStatus; at: string }[] = [];
  for (const h of view.history) {
    const s = citizenStatus(h.status);
    if (out.at(-1)?.status !== s) out.push({ status: s, at: h.at.toISOString() });
  }
  return out;
}

function present(view: TrackingView) {
  return {
    code: view.publicCode,
    status: citizenStatus(view.status),
    timeline: timeline(view),
    messages: view.messages.map((m) => ({ body: m.body, at: m.at.toISOString() })),
    can_withdraw: canReporterWithdraw(view.status),
  };
}

export function postTrack(req: Request, deps: ApiDeps): Promise<Response> {
  return guarded(async () => {
    const auth = await authenticate(req, deps);
    return 'response' in auth ? auth.response : json(present(auth.view));
  });
}

export function postWithdraw(req: Request, deps: ApiDeps): Promise<Response> {
  return guarded(async () => {
    const auth = await authenticate(req, deps);
    if ('response' in auth) return auth.response;
    if (!canReporterWithdraw(auth.view.status)) return error(409, 'cannot_withdraw');
    await transitionReport(
      auth.view.reportId,
      { type: 'reporter.withdraw' },
      { type: 'reporter' },
      deps,
    );
    const view = await findForTracking(deps.sql, auth.view.publicCode);
    return json(present(view!));
  });
}
