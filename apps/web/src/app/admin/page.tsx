import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { services, sessionCookie } from '../../server/services';
import { AdminCenter } from '../../components/admin-center';
export const dynamic = 'force-dynamic';
export default async function AdminPage() {
  const user = await services().auth.session((await cookies()).get(sessionCookie)?.value);
  if (!user) redirect('/login');
  return <AdminCenter />;
}
