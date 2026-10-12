import { services } from '../../../../server/services';
import { apiResponse, readBody } from '../../../../server/api';
export const runtime = 'nodejs';
/** Public provider callback. No cookie authority; authenticated API lookup happens in the worker. */
export async function POST(request: Request) {
  return apiResponse(async correlationId => {
    await services().paymentWebhooks.receive(await readBody(request), correlationId);
    return Response.json({ received: true }, { status: 200 });
  });
}
