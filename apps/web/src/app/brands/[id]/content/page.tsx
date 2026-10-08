import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { services, sessionCookie } from '../../../../server/services';
import { ContentStudio } from '../../../../components/content-studio';
export const dynamic = 'force-dynamic';
export default async function ContentPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{organization?:string;tab?:string}>}) {
  const user = await services().auth.session((await cookies()).get(sessionCookie)?.value);
  if (!user) redirect('/login');
  const {id} = await params; const {organization,tab} = await searchParams;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(organization).success) redirect('/dashboard');
  const brain = await services().brands.getBrandBrain(user.userId,organization!,id);
  return <ContentStudio initialTab={tab} tenantId={organization!} brandId={id} brandName={brain.brand.name} role={brain.role} verified={!!user.emailVerifiedAt} />;
}
