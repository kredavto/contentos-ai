import { cookies } from 'next/headers';
import { DomainError } from '@contentos/types';
import { services, sessionCookie } from '../../../server/services';
import { apiResponse, assertOrigin, clientAddress, readBody, readPhotoUpload } from '../../../server/api';
import {readLibrarySource} from '../../../server/library-upload';
export const runtime = 'nodejs';
type RouteContext = { params: Promise<{ path: string[] }> };
async function dispatch(request: Request, context: RouteContext) {
  return apiResponse(async correlationId => {
    const { search, youtubeResolutions, publicationAnalytics, youtubePublications, youtube, libraryMedia, images, covers, funnels, utm, privacy, admin, agency, team, notifications, billing, auth, brands, generation, consent, media, avatars, voices, videos, calendar, social, publishing, analytics, channelAnalytics, performance, env } = services();
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
    if (key === 'privacy' && request.method === 'GET') return ok(await privacy.overview(user.userId));
    if (key === 'privacy/export' && request.method === 'POST') { await auth.throttle('account-export', user.userId); return ok(await privacy.exportAccount(user.userId, await readBody(request), correlationId)); }
    if (key === 'privacy/deletion' && request.method === 'POST') { await auth.throttle('account-deletion', user.userId); return ok(await privacy.request(user.userId, await readBody(request), correlationId), 202); }
    if (key === 'privacy/deletion/cancel' && request.method === 'POST') return ok(await privacy.cancel(user.userId, await readBody(request), correlationId));
    if (path[0] === 'admin') {
      if(key==='admin/youtube-resolution'&&request.method==='POST'){await auth.throttle('youtube-resolution',user.userId);return ok(await youtubeResolutions.request(user.userId,await readBody(request),correlationId),202);}
      if(key==='admin/youtube-resolution/tasks'&&request.method==='GET'){const query=new URL(request.url).searchParams;return ok(await youtubeResolutions.tasks(user.userId,query.get('tenantId')??'',query.get('jobId')??'',correlationId));}
      if (key === 'admin' && request.method === 'GET') return ok(await admin.overview(user.userId, correlationId));
      if (key === 'admin/finance' && request.method === 'GET') { await auth.throttle('admin-finance', user.userId); return ok(await admin.finance(user.userId, Object.fromEntries(new URL(request.url).searchParams), correlationId)); }
      if (key === 'admin/plans' && request.method === 'GET') return ok(await admin.catalog(user.userId, correlationId));
      if (key === 'admin/plans' && request.method === 'POST') return ok(await admin.publishPlan(user.userId, await readBody(request), correlationId));
      if (key === 'admin/data' && request.method === 'GET') return ok(await admin.list(user.userId, Object.fromEntries(new URL(request.url).searchParams), correlationId));
      if (key === 'admin/revoke-sessions' && request.method === 'POST') return ok(await admin.revokeSessions(user.userId, await readBody(request), correlationId));
    }
    if(request.method==='POST'&&key==='team/accept')return ok(await team.accept(user.userId,await readBody(request),correlationId));
    if (path[0] === 'organizations' && path[1]) {
      const tenantId = path[1];
      if(path[2]==='search'&&path.length===3&&request.method==='GET'){await auth.throttle('search',user.userId);return ok(await search.search(user.userId,tenantId,Object.fromEntries(new URL(request.url).searchParams)));}
      if (path[2] === 'agency') {
        if (path.length === 3 && request.method === 'GET') return ok(await agency.overview(user.userId, tenantId));
        if (path.length === 3 && request.method === 'PUT') return ok(await agency.setMode(user.userId, tenantId, await readBody(request), correlationId));
        if (path[3] === 'clients' && path.length === 4 && request.method === 'POST') return ok(await agency.addClient(user.userId, tenantId, await readBody(request), correlationId), 201);
        if (path[3] === 'clients' && path[4] && path.length === 5 && request.method === 'PUT') return ok(await agency.setArchived(user.userId, tenantId, path[4], await readBody(request), correlationId));
      }
      if(path[2]==='team'){
        if(path.length===3&&request.method==='GET')return ok(await team.overview(user.userId,tenantId));
        if(path.length===4&&request.method==='POST'){
          const input=await readBody(request);
          if(path[3]==='invite')return ok(await team.invite(user.userId,tenantId,input,correlationId),201);
          if(path[3]==='role')return ok(await team.changeRole(user.userId,tenantId,input,correlationId));
          if(path[3]==='remove')return ok(await team.remove(user.userId,tenantId,input,correlationId));
          if(path[3]==='transfer')return ok(await team.transfer(user.userId,tenantId,input,correlationId));
          if(path[3]==='revoke')return ok(await team.revoke(user.userId,tenantId,input,correlationId));
        }
      }
      if (path.length === 2 && request.method === 'GET') return ok(await brands.overview(user.userId, tenantId));
      if(path[2]==='notifications'&&path.length===3&&request.method==='GET')return ok(await notifications.list(user.userId,tenantId,Object.fromEntries(new URL(request.url).searchParams)));
      if(path[2]==='notifications'&&path[3]==='read-batch'&&path.length===4&&request.method==='POST'){await auth.throttle('mutation',user.userId);return ok(await notifications.markReadBatch(user.userId,tenantId,await readBody(request)));}
      if(path[2]==='notifications'&&path[3]==='read'&&path.length===4&&request.method==='POST')return ok(await notifications.markRead(user.userId,tenantId,await readBody(request)));
      if(path[2]==='billing'){
        if(path.length===3&&request.method==='GET')return ok(await billing.overview(user.userId,tenantId));
        if(path[3]==='checkout'&&path.length===4&&request.method==='POST')return ok(await billing.checkout(user.userId,tenantId,await readBody(request),correlationId),202);
        if(path[3]==='orders'&&path[4]&&path.length===5&&request.method==='GET')return ok(await billing.orderStatus(user.userId,tenantId,path[4]));
        if(path[3]==='purchase-preview'&&path[4]&&path.length===5&&request.method==='GET')return ok(await billing.purchasePreview(user.userId,tenantId,path[4]));
        if(path[3]==='renewal-policy'&&path[4]&&path.length===5&&request.method==='GET')return ok(await billing.renewalPolicy(user.userId,tenantId,path[4]));
        if(path[3]==='accept-renewal'&&path.length===4&&request.method==='POST')return ok(await billing.acceptRenewal(user.userId,tenantId,await readBody(request),{ip,userAgent:request.headers.get('user-agent')??''},correlationId),201);
        if(path[3]==='cancel-renewal'&&path.length===4&&request.method==='POST')return ok(await billing.cancelRenewal(user.userId,tenantId,await readBody(request),correlationId));
      }
      if (path[2] === 'trial' && path.length === 3 && request.method === 'POST') return ok(await generation.grantTrial(user.userId, tenantId, correlationId));
      if (path[2] === 'brands') {
        if (path[3] && path[4] === 'brain' && path[5] && path.length === 6) {
          if (request.method === 'GET') return ok(await brands.collection(user.userId, tenantId, path[3], path[5]));
          if (request.method === 'PUT') return ok(await brands.saveCollection(user.userId, tenantId, path[3], path[5], await readBody(request), correlationId));
        }
        if(path[3]&&path[4]==='performance'&&path.length===5){
          if(request.method==='GET')return ok(await performance.list(user.userId,tenantId,path[3]));
          if(request.method==='POST')return ok(await performance.decide(user.userId,tenantId,path[3],await readBody(request),correlationId));
        }
        if(path[3]&&path[4]==='publication-analytics'&&path.length===5){
          if(request.method==='GET')return ok(await publicationAnalytics.overview(user.userId,tenantId,path[3]));
          if(request.method==='POST'){await auth.throttle('publication-analytics',user.userId);return ok(await publicationAnalytics.request(user.userId,tenantId,path[3],await readBody(request),correlationId),202);}
        }
        if(path[3]&&path[4]==='channel-analytics'){
          if(path.length===5&&request.method==='GET')return ok(await channelAnalytics.overview(user.userId,tenantId,path[3]));
          if(path.length===5&&request.method==='POST')return ok(await channelAnalytics.request(user.userId,tenantId,path[3],await readBody(request),correlationId),202);
          if(path[5]&&path.length===6&&request.method==='GET')return ok(await channelAnalytics.history(user.userId,tenantId,path[3],path[5]));
        }
        if(path[3]&&path[4]==='analytics'){
          if(path.length===5&&request.method==='GET')return ok(await analytics.overview(user.userId,tenantId,path[3]));
          if(path.length===5&&request.method==='POST')return ok(await analytics.record(user.userId,tenantId,path[3],await readBody(request),correlationId),201);
          if(path[5]&&path.length===6&&request.method==='GET')return ok(await analytics.history(user.userId,tenantId,path[3],path[5]));
        }
        if(path[3]&&path[4]==='publishing'){
          if(path.length===5&&request.method==='GET')return ok(await publishing.overview(user.userId,tenantId,path[3]));
          if(path.length===5&&request.method==='POST')return ok(await publishing.approve(user.userId,tenantId,path[3],await readBody(request),correlationId),202);
          if(path[5]&&path[6]==='cancel'&&path.length===7&&request.method==='POST'){await publishing.cancel(user.userId,tenantId,path[3],path[5]);return ok({cancelled:true});}
        }
        if(path[3]&&path[4]==='youtube'){
          if(path.length===6&&path[5]==='publications'&&request.method==='GET')return ok(await youtubePublications.overview(user.userId,tenantId,path[3]));
          if(path.length===6&&path[5]==='publications'&&request.method==='POST'){await auth.throttle('youtube-approve',user.userId);return ok(await youtubePublications.approve(user.userId,tenantId,path[3],await readBody(request),correlationId),202);}
          if(path.length===6&&path[5]==='categories'&&request.method==='GET'){await auth.throttle('youtube-categories',user.userId);return ok(await youtubePublications.categories(user.userId,tenantId,path[3],new URL(request.url).searchParams.get('connectionId')??'',new URL(request.url).searchParams.get('regionCode')??'',correlationId));}
          if(path.length===5&&request.method==='GET')return ok(await youtube.overview(user.userId,tenantId,path[3]));
          if(path.length===5&&request.method==='POST'){await auth.throttle('youtube-connect',user.userId);return ok(await youtube.start(user.userId,user.id,tenantId,path[3],await readBody(request),correlationId));}
          if(path.length===7&&path[5]&&path[6]==='check'&&request.method==='POST'){await auth.throttle('youtube-check',user.userId);return ok(await youtube.check(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId));}
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
        if(path[3]&&path[4]==='funnels'){
          const query=Object.fromEntries(new URL(request.url).searchParams);
          if(path.length===5&&request.method==='GET')return ok(await funnels.list(user.userId,tenantId,path[3],query));
          if(path.length===5&&request.method==='POST')return ok(await funnels.create(user.userId,tenantId,path[3],await readBody(request),correlationId),201);
          if(path[5]==='choices'&&path.length===6&&request.method==='GET')return ok(await funnels.choices(user.userId,tenantId,path[3],query));
          if(path[5]&&path[6]==='measurements'&&path.length===7){
            if(request.method==='GET')return ok(await funnels.measurements(user.userId,tenantId,path[3],path[5],query));
            if(request.method==='POST')return ok(await funnels.measure(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId),201);
          }
        }
        if(path[3]&&path[4]==='images'){
          if(path.length===5&&request.method==='GET')return ok(await images.overview(user.userId,tenantId,path[3]));
          if(path.length===5&&request.method==='POST')return ok(await images.request(user.userId,tenantId,path[3],await readBody(request),correlationId),202);
          if(path[5]&&path.length===7&&path[6]==='delete'&&request.method==='POST')return ok(await images.delete(user.userId,tenantId,path[3],path[5],correlationId),202);
          if(path[5]&&path.length===7&&path[6]==='approve'&&request.method==='POST'){await images.approve(user.userId,tenantId,path[3],path[5],correlationId);return ok({approved:true});}
          if(path[5]&&path.length===7&&['preview','download'].includes(path[6]!)&&request.method==='GET')return ok(await images.download(user.userId,tenantId,path[3],path[5],path[6]==='download',correlationId));
        }
        if(path[3]&&path[4]==='utm'){
          if(path.length===5&&request.method==='GET')return ok(await utm.list(user.userId,tenantId,path[3],Object.fromEntries(new URL(request.url).searchParams)));
          if(path.length===5&&request.method==='POST')return ok(await utm.create(user.userId,tenantId,path[3],await readBody(request),correlationId),201);
          if(path[5]&&path.length===7&&path[6]==='archive'&&request.method==='POST')return ok(await utm.archive(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId));
        }
        if(path[3]&&path[4]==='calendar'){
          if(path.length===5&&request.method==='GET'){const query=new URL(request.url).searchParams;return ok(await calendar.list(user.userId,tenantId,path[3],{from:query.get('from'),to:query.get('to')}));}
          if(path.length===5&&request.method==='POST')return ok(await calendar.create(user.userId,tenantId,path[3],await readBody(request),correlationId),201);
          if(path[5]&&path.length===6&&request.method==='PUT')return ok(await calendar.update(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId));
          if(path[5]&&path.length===7&&path[6]==='cancel'&&request.method==='POST'){await calendar.cancel(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId);return ok({cancelled:true});}
        }
        if(path[3]&&path[4]==='videos'){
          if(path[5]&&path[6]==='covers'){
            if(path.length===7&&request.method==='GET')return ok(await covers.overview(user.userId,tenantId,path[3],path[5]));
            if(path.length===7&&request.method==='POST')return ok(await covers.request(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId),202);
            if(path.length===7&&request.method==='PUT')return ok(await covers.select(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId));
            if(path.length===8&&path[7]&&request.method==='GET')return ok(await covers.download(user.userId,tenantId,path[3],path[5],path[7],correlationId));
          }
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
            if(path[6]==='approve'&&request.method==='POST')return ok(await videos.approve(user.userId,tenantId,path[3],path[5],correlationId,await readBody(request)));
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
        if(path[3]&&path[4]==='library-media'){
          if(path.length===5&&request.method==='GET')return ok(await libraryMedia.overview(user.userId,tenantId,path[3]));
          if(path.length===5&&request.method==='POST'){
            await auth.throttle('library-upload',`${tenantId}:${user.userId}`);
            return ok(await libraryMedia.begin(user.userId,tenantId,path[3],await readBody(request),correlationId),201);
          }
          if(path.length===6&&path[5]==='upload-intents'&&request.method==='POST'){
            await auth.throttle('library-upload',`${tenantId}:${user.userId}`);
            return ok(await libraryMedia.beginBrowserUpload(user.userId,tenantId,path[3],await readBody(request),correlationId),201);
          }
          if(path[5]&&path.length===8&&path[6]==='chunks'&&path[7]&&request.method==='POST'){
            await auth.throttle('library-chunk',`${tenantId}:${user.userId}`);
            const index=Number(path[7]);
            await libraryMedia.authorizeChunk(user.userId,tenantId,path[3],path[5],index);
            const source=await readLibrarySource(request,1);
            return ok(await libraryMedia.uploadChunk(user.userId,tenantId,path[3],path[5],index,source.bytes,source.mimeType),202);
          }
          if(path[5]&&path.length===7&&path[6]==='source'&&request.method==='POST'){
            await auth.throttle('library-upload',`${tenantId}:${user.userId}`);
            await libraryMedia.authorizeSource(user.userId,tenantId,path[3],path[5]);
            const source=await readLibrarySource(request);
            return ok(await libraryMedia.uploadSource(user.userId,tenantId,path[3],path[5],source.bytes,source.mimeType),202);
          }
          if(path[5]&&path.length===7&&path[6]==='upload-intent'&&request.method==='GET')return ok(await libraryMedia.resumeUpload(user.userId,tenantId,path[3],path[5]));
          if(path[5]&&path.length===7&&path[6]==='confirm'&&request.method==='POST')return ok(await libraryMedia.confirm(user.userId,tenantId,path[3],path[5]),202);
          if(path[5]&&path.length===7&&path[6]==='delete'&&request.method==='POST')return ok(await libraryMedia.delete(user.userId,tenantId,path[3],path[5],correlationId),202);
          if(path[5]&&path.length===7&&path[6]==='download'&&request.method==='GET')return ok(await libraryMedia.download(user.userId,tenantId,path[3],path[5]));
        }
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
        if(path[3]&&path[4]==='posts'&&path[5]&&path[6]==='history'&&path.length===7&&request.method==='GET')return ok(await generation.postHistoryPage(user.userId,tenantId,path[3],path[5],Object.fromEntries(new URL(request.url).searchParams)));
        if (path[3] && path[4] === 'posts' && path[5] && path.length === 6) {
          if (request.method === 'GET') return ok(await generation.postHistory(user.userId, tenantId, path[3], path[5]));
          if (request.method === 'PUT') { await auth.throttle('mutation', user.userId); return ok(await generation.editPost(user.userId, tenantId, path[3], path[5], await readBody(request), correlationId)); }
        }
        if(path[3]&&path[4]==='carousels'&&path[5]&&path[6]==='history'&&path.length===7&&request.method==='GET')return ok(await generation.carouselHistoryPage(user.userId,tenantId,path[3],path[5],Object.fromEntries(new URL(request.url).searchParams)));
        if(path[3]&&path[4]==='carousels'&&path[5]&&path[6]==='export'&&path.length===7&&request.method==='GET')return ok(await generation.authorizeCarouselExport(user.userId,tenantId,path[3],path[5],Object.fromEntries(new URL(request.url).searchParams)));
        if(path[3]&&path[4]==='carousels'&&path[5]&&path[6]==='archive'&&path.length===7&&request.method==='PUT'){await auth.throttle('mutation',user.userId);return ok(await generation.setCarouselArchived(user.userId,tenantId,path[3],path[5],await readBody(request),correlationId));}
        if (path[3] && path[4] === 'carousels' && path[5] && path.length === 6) {
          if (request.method === 'GET') return ok(await generation.carouselHistory(user.userId, tenantId, path[3], path[5]));
          if (request.method === 'PUT') { await auth.throttle('mutation', user.userId); return ok(await generation.editCarousel(user.userId, tenantId, path[3], path[5], await readBody(request), correlationId)); }
        }
        if (path[3] && path[4] === 'scripts' && path[5] && path.length === 6) {
          if (request.method === 'GET') return ok(await generation.history(user.userId, tenantId, path[3], path[5]));
          if (request.method === 'PUT') {
            await auth.throttle('mutation', user.userId);
            return ok(await generation.editScript(user.userId, tenantId, path[3], path[5], await readBody(request), correlationId));
          }
        }
        if (path.length === 3 && request.method === 'POST') return ok(await brands.createBrand(user.userId, tenantId, await readBody(request), correlationId), 201);
        if (path[3] && path.length === 4 && request.method === 'GET') return ok(await brands.getBrandBrain(user.userId, tenantId, path[3]));
        if (path[3] && path[4] === 'profile' && path.length === 5 && request.method === 'PUT') return ok(await brands.saveProfile(user.userId, tenantId, path[3], await readBody(request), correlationId));
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
