import { postReport } from '../../../../lib/api/reports';
import { apiDeps } from '../../../../lib/services';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return postReport(req, await apiDeps());
}
