import {cookies} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import Link from 'next/link';
import {z} from 'zod';
import {DomainError} from '@contentos/types';
import {services,sessionCookie} from '../../../../../server/services';
export const dynamic='force-dynamic';
export default async function PublicationDetailPage({params,searchParams}:{params:Promise<{id:string;publicationId:string}>;searchParams:Promise<{organization?:string|string[]}>}){
  const app=services();
  const user=await app.auth.session((await cookies()).get(sessionCookie)?.value);
  if(!user)redirect('/login');
  const {id,publicationId}=await params;const {organization}=await searchParams;
  const scope=z.object({tenantId:z.uuid(),brandId:z.uuid(),publicationId:z.uuid()}).safeParse({tenantId:organization,brandId:id,publicationId});
  if(!scope.success)notFound();
  const {tenantId,brandId}=scope.data;
  const publication=await app.publishing.publication(user.userId,tenantId,brandId,publicationId).catch((error:unknown)=>{
    if(error instanceof DomainError&&(error.code==='NOT_FOUND'||error.code==='NOT_AUTHORIZED'))notFound();
    throw error;
  });
  if(publication.role==='CLIENT_APPROVER')redirect(`/approvals?organization=${tenantId}`);
  return <section aria-label="Просмотр публикации" className="page-container stack" style={{overflowWrap:'anywhere'}}>
    <nav aria-label="Навигация публикации" className="studio-actions"><Link className="button secondary" href={`/dashboard?organization=${tenantId}`}>Поиск по организации</Link><Link className="button secondary" href={`/brands/${brandId}/content?organization=${tenantId}&tab=publishing`}>Открыть раздел публикаций</Link></nav>
    <header><p className="page-eyebrow">{publication.brandName}</p><h1>{publication.title}</h1><p>{publication.provider} · {publication.type}</p><p>Сохранённый статус задания: {publication.status}</p></header>
    <p className="notice">Только просмотр сохранённой записи. Время результата может означать момент подтверждения системой, а не точное время размещения на платформе. Доступность публикации и её текущее состояние на внешней платформе здесь не проверяются. Повторная отправка и изменение публикации недоступны.</p>
    {publication.contentTitle!==publication.title?<p>Текущее название материала: {publication.contentTitle}. Ниже показан сохранённый текст публикации, а не текущий черновик.</p>:null}
    <article aria-label="Текст публикации" className="panel stack"><h2>Сохранённый текст</h2><p className="preserve-lines">{publication.caption}</p></article>
    <section className="panel stack" aria-label="Сведения о публикации"><h2>Сохранённые сведения</h2><dl>
      <dt>Сохранённое время результата (UTC)</dt><dd><time dateTime={publication.publishedAt.toISOString()}>{publication.publishedAt.toISOString()}</time></dd>
      <dt>Запись получена (UTC)</dt><dd><time dateTime={publication.recordedAt.toISOString()}>{publication.recordedAt.toISOString()}</time></dd>
      <dt>Плановое время (UTC)</dt><dd><time dateTime={publication.scheduledAt.toISOString()}>{publication.scheduledAt.toISOString()}</time></dd>
      <dt>Сохранённый часовой пояс</dt><dd>{publication.timeZone}</dd>
      <dt>Сохранённая видимость</dt><dd>{publication.privacy}</dd>
      <dt>Комментарии по сохранённым настройкам</dt><dd>{publication.commentsEnabled?'Включены':'Выключены'}</dd>
    </dl></section>
  </section>;
}
