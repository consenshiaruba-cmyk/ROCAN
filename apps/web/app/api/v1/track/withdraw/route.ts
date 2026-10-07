import { postWithdraw } from '../../../../../lib/api/track';
import { apiDeps } from '../../../../../lib/services';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return postWithdraw(req, await apiDeps());
}
