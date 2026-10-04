import { cookies } from 'next/headers';
import { DomainError } from '@contentos/types';
import { services, sessionCookie } from '../../../server/services';
import { apiResponse, assertOrigin, clientAddress, readBody } from '../../../server/api';
export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ path: string[] }> };
async function dispatch(request: Request, context: RouteContext) {
  return apiResponse(async correlationId => {
    const { auth, brands, generation, env } = services();
    const { path } = await context.params;
    const key = path.join('/');
    const jar = await cookies();
    if (request.method !== 'GET') assertOrigin(request, env.APP_URL);
    const ip = clientAddress(request);
    const ok = (data: unknown, status = 200) => Response.json({ data }, { status });
    if (request.method === 'POST' && path[0] === 'auth') {
      if (key === 'auth/register') return ok(await auth.register(await readBody(request), ip, correlationId), 202);
      if (key === 'auth/login') {
        const session = await auth.login(await readBody(request), ip, correlationId);
        jar.set(sessionCookie, session.token, { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/', expires: session.expiresAt });
        return ok({ authenticated: true });
      }
      if (key === 'auth/verify') return ok(await auth.verify(await readBody(request), ip, correlationId));
      if (key === 'auth/forgot-password') return ok(await auth.requestToken(await readBody(request), 'RESET_PASSWORD', ip, correlationId), 202);
      if (key === 'auth/resend-verification') return ok(await auth.requestToken(await readBody(request), 'VERIFY_EMAIL', ip, correlationId), 202);
      if (key === 'auth/reset-password') return ok(await auth.reset(await readBody(request), ip, correlationId));
      if (key === 'auth/logout') { await auth.logout(jar.get(sessionCookie)?.value, correlationId); jar.delete(sessionCookie); return ok({ authenticated: false }); }
    }
    const user = await auth.session(jar.get(sessionCookie)?.value);
    if (!user) throw new DomainError('NOT_AUTHORIZED', 401);
    if (request.method === 'GET' && key === 'me') return ok(user);
    if (request.method === 'POST' && key === 'auth/revoke-sessions') { await auth.revokeSessions(user.userId, correlationId); jar.delete(sessionCookie); return ok({ authenticated: false }); }
    if (request.method === 'GET' && key === 'organizations') return ok(await brands.listOrganizations(user.userId));
    if (request.method === 'POST') {
      // A shared per-user mutation budget complements the authentication throttles.
      await auth.throttle('mutation', user.userId);
      if (key === 'organizations') return ok(await brands.createOrganization(user.userId, await readBody(request), correlationId), 201);
    }
    if (path[0] === 'organizations' && path[1]) {
      const tenantId = path[1];
      if (path.length === 2 && request.method === 'GET') return ok(await brands.overview(user.userId, tenantId));
      if (path[2] === 'trial' && path.length === 3 && request.method === 'POST') return ok(await generation.grantTrial(user.userId, tenantId, correlationId));
      if (path[2] === 'brands') {
        if (path[3] && path[4] === 'content' && path.length === 5 && request.method === 'GET') return ok(await generation.overview(user.userId, tenantId, path[3]));
        if (path[3] && path[4] === 'jobs' && path.length === 5 && request.method === 'POST') return ok(await generation.enqueue(user.userId, tenantId, path[3], await readBody(request), correlationId), 202);
        if (path[3] && path[4] === 'scripts' && path[5] && path.length === 6) {
          if (request.method === 'GET') return ok(await generation.history(user.userId, tenantId, path[3], path[5]));
          if (request.method === 'PUT') {
            await auth.throttle('mutation', user.userId);
            return ok(await generation.editScript(user.userId, tenantId, path[3], path[5], await readBody(request), correlationId));
          }
        }
        if (path.length === 3 && request.method === 'POST') return ok(await brands.createBrand(user.userId, tenantId, await readBody(request), correlationId), 201);
        if (path[3] && path.length === 4 && request.method === 'GET') return ok(await brands.getBrandBrain(user.userId, tenantId, path[3]));
        if (path[3] && path[4] === 'onboarding' && path.length === 5 && request.method === 'PUT') {
          await auth.throttle('onboarding', user.userId);
          return ok(await brands.saveOnboarding(user.userId, tenantId, path[3], await readBody(request), correlationId));
        }
      }
    }
    throw new DomainError('NOT_FOUND', 404);
  });
}
export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
