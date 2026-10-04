import { cookies } from 'next/headers';
import { DomainError } from '@contentos/types';
import { services, sessionCookie } from '../../../server/services';
import { apiResponse, assertOrigin, clientAddress, readBody, readPhotoUpload } from '../../../server/api';
export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ path: string[] }> };
async function dispatch(request: Request, context: RouteContext) {
  return apiResponse(async correlationId => {
    const { auth, brands, generation, consent, media, avatars, voices, videos, calendar, social, publishing, env } = services();
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
    if (request.method !== 'GET') {
      // A shared per-user mutation budget complements the authentication throttles.
      await auth.throttle('mutation', user.userId);
      if (request.method === 'POST' && key === 'organizations') return ok(await brands.createOrganization(user.userId, await readBody(request), correlationId), 201);
    }
    if (path[0] === 'organizations' && path[1]) {
      const tenantId = path[1];
      if (path.length === 2 && request.method === 'GET') return ok(await brands.overview(user.userId, tenantId));
      if (path[2] === 'trial' && path.length === 3 && request.method === 'POST') return ok(await generation.grantTrial(user.userId, tenantId, correlationId));
      if (path[2] === 'brands') {
        if(path[3]&&path[4]==='publishing'){
          if(path.length===5&&request.method==='GET')return ok(await publishing.overview(user.userId,tenantId,path[3]));
          if(path.length===5&&request.method==='POST')return ok(await publishing.approve(user.userId,tenantId,path[3],await readBody(request),correlationId),202);
          if(path[5]&&path[6]==='cancel'&&path.length===7&&request.method==='POST'){await publishing.cancel(user.userId,tenantId,path[3],path[5]);return ok({cancelled:true});}
        }
        if(path[3]&&path[4]==='social'){
          if(path.length===5&&request.method==='GET')return ok(await social.overview(user.userId,tenantId,path[3]));
          if(path.length===5&&request.method==='POST')return ok(await social.connect(user.userId,tenantId,path[3],await readBody(request),correlationId),201);
          if(path[5]&&path.length===7&&request.method==='POST'){
            if(path[6]==='refresh')return ok(await social.refresh(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId));
            if(path[6]==='reconnect')return ok(await social.reconnect(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId));
            if(path[6]==='disconnect'){await social.disconnect(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId);return ok({disconnected:true});}
            if(path[6]==='rewrap'){await social.rewrap(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId);return ok({rotated:true});}
          }
        }
        if(path[3]&&path[4]==='calendar'){
          if(path.length===5&&request.method==='GET'){const query=new URL(request.url).searchParams;return ok(await calendar.list(user.userId,tenantId,path[3],{from:query.get('from'),to:query.get('to')}));}
          if(path.length===5&&request.method==='POST')return ok(await calendar.create(user.userId,tenantId,path[3],await readBody(request),correlationId),201);
          if(path[5]&&path.length===6&&request.method==='PUT')return ok(await calendar.update(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId));
          if(path[5]&&path.length===7&&path[6]==='cancel'&&request.method==='POST'){await calendar.cancel(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId);return ok({cancelled:true});}
        }
        if(path[3]&&path[4]==='videos'){
          if(path.length===8&&path[5]&&path[6]==='captions'&&path[7]==='confirm'&&request.method==='POST')return ok(await videos.confirmCaptions(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId),202);
          if(path.length===5&&request.method==='GET')return ok(await videos.overview(user.userId,tenantId,path[3]));
          if(path.length===5&&request.method==='POST')return ok(await videos.create(user.userId,tenantId,path[3],await readBody(request),correlationId),202);
          if(path[5]&&path.length===7){
            if(path[6]==='captions'&&request.method==='GET')return ok(await videos.captionReview(user.userId,tenantId,path[3],path[5],correlationId));
            if(path[6]==='captions'&&request.method==='PUT')return ok(await videos.editCaptions(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId));
            if(path[6]==='manual-captions'&&request.method==='POST'){await videos.manualCaptions(user.userId,tenantId,path[3],path[5],correlationId);return ok({status:'WAITING_REVIEW'});}
            if(path[6]==='delete'&&request.method==='POST')return ok(await videos.delete(user.userId,tenantId,path[3],path[5],correlationId),202);
            if(path[6]==='resume'&&request.method==='POST'){await videos.resume(user.userId,tenantId,path[3],path[5],correlationId);return ok({status:'RETRY'},202);}
            if(path[6]==='download'&&request.method==='GET')return ok(await videos.download(user.userId,tenantId,path[3],path[5],correlationId));
            if(path[6]==='history'&&request.method==='GET')return ok(await videos.history(user.userId,tenantId,path[3],path[5]));
            if(path[6]==='approve'&&request.method==='POST')return ok(await videos.approve(user.userId,tenantId,path[3],path[5],correlationId));
          }
        }
        if (path[3] && path[4] === 'voices') {
          if(path.length===5&&request.method==='GET')return ok(await voices.overview(user.userId,tenantId,path[3]));
          if(path.length===5&&request.method==='POST')return ok(await voices.refresh(user.userId,tenantId,path[3],await readBody(request),correlationId));
        }
        if (path[3] && path[4] === 'avatars') {
          if(path[5]&&path[6]==='voice'&&path.length===7&&request.method==='POST'){await voices.select(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId);return ok({saved:true});}
          if (path.length === 5 && request.method === 'GET') return ok(await avatars.overview(user.userId,tenantId,path[3]));
          if (path.length === 5 && request.method === 'POST') return ok(await avatars.create(user.userId,tenantId,path[3],await readBody(request),correlationId),202);
          if (path[5] && path[6] === 'delete' && path.length === 7 && request.method === 'POST') return ok(await avatars.delete(user.userId,tenantId,path[3],path[5],correlationId),202);
        }
        if (path[3] && path[4] === 'avatar-jobs' && path[5] && path[6] === 'resume' && path.length === 7 && request.method === 'POST') {await avatars.resume(user.userId,tenantId,path[3],path[5],correlationId);return ok({status:'RETRY'},202);}
        if (path[3] && path[4] === 'media') {
          if (path.length === 5 && request.method === 'GET') return ok(await media.overview(user.userId,tenantId,path[3]));
          if (path.length === 5 && request.method === 'POST') {
            await media.authorizeUpload(user.userId,tenantId,path[3]);
            const upload = await readPhotoUpload(request);
            return ok(await media.upload(user.userId,tenantId,path[3],upload.input,upload.bytes,correlationId),201);
          }
          if (path[5] && path[6] === 'download' && path.length === 7 && request.method === 'GET') return ok(await media.download(user.userId,tenantId,path[3],path[5],correlationId));
          if (path[5] && path[6] === 'delete' && path.length === 7 && request.method === 'POST') return ok(await media.delete(user.userId,tenantId,path[3],path[5],correlationId),202);
        }
        if (path[3] && path[4] === 'consents') {
          if (path.length === 5 && request.method === 'GET') return ok(await consent.overview(user.userId, tenantId, path[3]));
          if (path.length === 5 && request.method === 'POST') return ok(await consent.accept(user.userId, tenantId, path[3], await readBody(request), {ip, userAgent: request.headers.get('user-agent') ?? ''}, correlationId), 201);
          if (path[5] === 'subjects' && path.length === 6 && request.method === 'POST') return ok(await consent.createSubject(user.userId, tenantId, path[3], await readBody(request), correlationId), 201);
          if (path[5] && path[6] === 'revoke' && path.length === 7 && request.method === 'POST') return ok(await consent.revoke(user.userId, tenantId, path[3], path[5], correlationId));
        }
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
