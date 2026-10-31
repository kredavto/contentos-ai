import {readinessService} from '../../../../server/readiness';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
 const result=await readinessService().check();
 return Response.json(result,{status:result.status==='ready'?200:503,headers:{'Cache-Control':'no-store'}});
}
