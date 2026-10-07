import { putUpload } from '../../../../../../lib/api/uploads';
import { apiDeps } from '../../../../../../lib/services';

export const dynamic = 'force-dynamic';

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ uploadId: string; n: string }> },
): Promise<Response> {
  return putUpload(req, await ctx.params, await apiDeps());
}
