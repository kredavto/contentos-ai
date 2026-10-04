import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { services, sessionCookie } from '../../../../server/services';
import { OnboardingWizard } from '../../../../components/onboarding-wizard';
export const dynamic = 'force-dynamic';
export default async function OnboardingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ organization?: string }> }) {
  const user = await services().auth.session((await cookies()).get(sessionCookie)?.value);
  if (!user) redirect('/login');
  const { id } = await params; const { organization } = await searchParams;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(organization).success) redirect('/dashboard');
  return <OnboardingWizard tenantId={organization!} brandId={id} />;
}
