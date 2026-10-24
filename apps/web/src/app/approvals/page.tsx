import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {z} from 'zod';
import {services,sessionCookie} from '../../server/services';
import {ApprovalInbox} from '../../components/approval-inbox';
export const dynamic='force-dynamic';
export default async function ApprovalsPage({searchParams}:{searchParams:Promise<{organization?:string}>}){
  const user=await services().auth.session((await cookies()).get(sessionCookie)?.value);if(!user)redirect('/login');
  const result=z.uuid().safeParse((await searchParams).organization);if(!result.success)redirect('/dashboard');
  await services().brands.overview(user.userId,result.data);
  return <ApprovalInbox key={result.data} tenantId={result.data}/>;
}
