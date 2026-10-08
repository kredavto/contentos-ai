import { z } from 'zod';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { services, sessionCookie } from '../../server/services';
import { Workspace } from '../../components/workspace';
export const dynamic = 'force-dynamic';
export default async function DashboardPage({searchParams}:{searchParams:Promise<{organization?:string}>}) {
  const user = await services().auth.session((await cookies()).get(sessionCookie)?.value);
  if (!user) redirect('/login');
  const {organization}=await searchParams;
  return <Workspace name={user.name} verified={Boolean(user.emailVerifiedAt)} initialOrganization={z.uuid().safeParse(organization).success?organization!:null} />;
}
