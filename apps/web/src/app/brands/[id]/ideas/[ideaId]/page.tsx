import {cookies} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import Link from 'next/link';
import {z} from 'zod';
import {DomainError} from '@contentos/types';
import {services,sessionCookie} from '../../../../../server/services';
export const dynamic='force-dynamic';
export default async function IdeaDetailPage({params,searchParams}:{params:Promise<{id:string;ideaId:string}>;searchParams:Promise<{organization?:string|string[]}>}){
  const app=services();
  const user=await app.auth.session((await cookies()).get(sessionCookie)?.value);
  if(!user)redirect('/login');
  const {id,ideaId}=await params;const {organization}=await searchParams;
  const scope=z.object({tenantId:z.uuid(),brandId:z.uuid(),ideaId:z.uuid()}).safeParse({tenantId:organization,brandId:id,ideaId});
  if(!scope.success)notFound();
  const {tenantId,brandId}=scope.data;
  const idea=await app.generation.currentIdea(user.userId,tenantId,brandId,ideaId).catch((error:unknown)=>{
    if(error instanceof DomainError&&(error.code==='NOT_FOUND'||error.code==='NOT_AUTHORIZED'))notFound();
    throw error;
  });
  if(idea.role==='CLIENT_APPROVER')redirect(`/approvals?organization=${tenantId}`);
  const fields=[['angle','Ракурс'],['hook','Начало'],['audienceLabel','Аудитория'],['pillarLabel','Тематическое направление'],['rationale','Обоснование']] as const;
  return <section aria-label="Просмотр идеи" className="page-container stack" style={{overflowWrap:'anywhere'}}>
    <nav aria-label="Навигация идеи" className="studio-actions"><Link className="button secondary" href={`/dashboard?organization=${tenantId}`}>Поиск по организации</Link><Link className="button secondary" href={`/brands/${brandId}/content?organization=${tenantId}&tab=ideas`}>Открыть студию идей</Link></nav>
    <header><p className="page-eyebrow">{idea.brandName}</p><h1>{idea.title}</h1><p>{idea.platform} · {idea.format} · {idea.funnelStage}</p><p>Статус: {idea.status}</p></header>
    <p className="notice">Только просмотр сохранённой идеи. Выбор и генерация доступны отдельно в студии согласно вашим правам.</p>
    <article aria-label="Текст идеи" className="panel stack">{fields.map(([key,label])=><section key={key}><h2>{label}</h2><p className="preserve-lines">{idea[key]}</p></section>)}</article>
    <section className="panel" aria-label="Оценка идеи"><h2>Сохранённая оценка: {idea.score}</h2><p>Оценка модели — не гарантия результата.</p><ul>{Object.entries(idea.scores).map(([name,value])=><li key={name}>{name}: {value}</li>)}</ul></section>
  </section>;
}
