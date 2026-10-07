import { createUpload } from '../../../../lib/api/uploads';
import { apiDeps } from '../../../../lib/services';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  return createUpload(req, await apiDeps());
}
