import {cookies} from 'next/headers';
import {DomainError} from '@contentos/types';
import {services,sessionCookie} from '../../../../../server/services';
import {apiResponse} from '../../../../../server/api';
export const runtime='nodejs';
export async function GET(request:Request){
  const response=await apiResponse(async correlationId=>{
    const {auth,youtube,env}=services(),jar=await cookies(),user=await auth.session(jar.get(sessionCookie)?.value);
    if(!user)throw new DomainError('NOT_AUTHORIZED',401);
    await auth.throttle('youtube-callback',user.userId);
    const url=new URL(request.url);
    if(request.url.length>16384||['state','code','error'].some(key=>url.searchParams.getAll(key).length>1))throw new DomainError('INVALID_INPUT');
    const result=await youtube.callback(user.userId,user.id,Object.fromEntries(url.searchParams),correlationId);
    const destination=new URL(`/brands/${result.brandId}/content`,env.APP_URL);
    destination.search=new URLSearchParams({organization:result.tenantId,tab:'integrations',youtube:result.connected?'connected':'denied'}).toString();
    return new Response(null,{status:303,headers:{Location:destination.href}});
  });
  response.headers.set('Referrer-Policy','no-referrer');return response;
}
