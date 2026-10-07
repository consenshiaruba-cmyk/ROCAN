import { RealClock } from '@rocan/clock';
import { handleMeta } from '../../../../lib/api/meta';
import { services } from '../../../../lib/services';

export const dynamic = 'force-dynamic';
const clock = new RealClock();

export function GET(): Promise<Response> {
  return handleMeta(services().db.sql, clock.now().getTime());
}
