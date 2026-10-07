import { dbCheck, readiness, s3Check, smtpCheck } from '@rocan/health';
import { services } from '../../lib/services';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { env, db, s3 } = services();
  const r = await readiness({
    database: dbCheck(db.sql),
    storage: s3Check(s3, env.S3_BUCKET_VAULT),
    smtp: smtpCheck(env.SMTP_URL),
  });
  // Public endpoint: report which dependency failed, never the error text.
  return Response.json(
    { status: r.status, checks: r.checks.map(({ name, ok }) => ({ name, ok })) },
    { status: r.status === 'ready' ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
