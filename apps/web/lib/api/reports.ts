// POST /api/v1/reports (SPEC §5.3). Idempotent on idempotency_key; the follow-up secret is
// generated on the device and only its argon2id hash is stored (phase-2 decision 2).

import { CreateReportSchema, cryptoRandomInt } from '@rocan/core';
import { createReport } from '@rocan/db';
import { clientAddress } from '../rateLimit';
import { error, guarded, issues, json, readJson, type ApiDeps } from './deps';
import { missingPhotos } from './uploads';

export function postReport(req: Request, deps: ApiDeps): Promise<Response> {
  return guarded(async () => {
    const parsed = CreateReportSchema.safeParse(await readJson(req));
    if (!parsed.success) return error(400, 'invalid_request', issues(parsed.error));
    const input = parsed.data;

    // A retry of an already accepted submission: same answer, no rate-limit cost.
    const [existing] = await deps.sql<{ public_code: string }[]>`
      SELECT public_code FROM report WHERE idempotency_key = ${input.idempotency_key}`;
    if (existing) return json({ public_code: existing.public_code, status: 'received' }, 200);

    // Server-side geofence is authoritative (SPEC §9.3): land polygon + 3 km.
    const [geo] = await deps.sql<{ inside: boolean }[]>`
      SELECT ST_DWithin(geom::geography,
                        ST_SetSRID(ST_MakePoint(${input.location.lon}, ${input.location.lat}), 4326)::geography,
                        3000) AS inside
      FROM coastline WHERE id = 1`;
    if (!geo?.inside) return error(400, 'outside_aruba');

    const missing = await missingPhotos(deps, input.upload_id, input.photo_count);
    if (missing.length > 0) return error(400, 'photos_missing', { missing });

    const key = deps.limiter.keyFor(clientAddress(req.headers, deps.env.TRUST_PROXY));
    const allowed = deps.limiter.consume(
      {
        name: 'reports',
        perHour: deps.env.RATE_LIMIT_REPORTS_PER_HOUR,
        perDay: deps.env.RATE_LIMIT_REPORTS_PER_DAY,
      },
      key,
    );
    if (!allowed) return error(429, 'rate_limited');

    const result = await createReport(input, {
      sql: deps.sql,
      clock: deps.clock,
      enqueue: deps.enqueue,
      randomInt: cryptoRandomInt,
      secretHash: await deps.secrets.hash(input.follow_up_secret),
    });
    return json({ public_code: result.publicCode, status: 'received' }, result.created ? 201 : 200);
  });
}
