import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { services, sessionCookie } from '../../server/services';
import { BillingStudio } from '../../components/billing-studio';
export const dynamic = 'force-dynamic';
export default async function BillingPage({searchParams}:{searchParams:Promise<{organization?:string}>}){
  const user=await services().auth.session((await cookies()).get(sessionCookie)?.value);
  if(!user)redirect('/login');
  const {organization}=await searchParams;
  if(!z.uuid().safeParse(organization).success)redirect('/dashboard');
  return <BillingStudio key={organization} tenantId={organization!}/>;
}
