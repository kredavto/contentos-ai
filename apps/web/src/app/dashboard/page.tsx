import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { services, sessionCookie } from '../../server/services';
import { Workspace } from '../../components/workspace';
export const dynamic = 'force-dynamic';
export default async function DashboardPage() {
  const user = await services().auth.session((await cookies()).get(sessionCookie)?.value);
  if (!user) redirect('/login');
  return <Workspace name={user.name} verified={Boolean(user.emailVerifiedAt)} />;
}
