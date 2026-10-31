import {cookies} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import Link from 'next/link';
import {z} from 'zod';
import {DomainError} from '@contentos/types';
import {services,sessionCookie} from '../../../../../server/services';
export const dynamic='force-dynamic';
export default async function ScriptDetailPage({params,searchParams}:{params:Promise<{id:string;scriptId:string}>;searchParams:Promise<{organization?:string|string[]}>}){
  const app=services();
  const user=await app.auth.session((await cookies()).get(sessionCookie)?.value);
  if(!user)redirect('/login');
  const {id,scriptId}=await params;const {organization}=await searchParams;
  const scope=z.object({tenantId:z.uuid(),brandId:z.uuid(),scriptId:z.uuid()}).safeParse({tenantId:organization,brandId:id,scriptId});
  if(!scope.success)notFound();
  const {tenantId,brandId}=scope.data;
  const script=await app.generation.currentScript(user.userId,tenantId,brandId,scriptId).catch((error:unknown)=>{
    if(error instanceof DomainError&&(error.code==='NOT_FOUND'||error.code==='NOT_AUTHORIZED'))notFound();
    throw error;
  });
  if(script.role==='CLIENT_APPROVER')redirect(`/approvals?organization=${tenantId}`);
  const fields=[['hook','HOOK — начало'],['context','CONTEXT — контекст'],['core','CORE — основная часть'],['proof','PROOF — подтверждение'],['cta','CTA — призыв к действию']] as const;
  return <section aria-label="Просмотр сценария" className="page-container stack" style={{overflowWrap:'anywhere'}}>
    <nav aria-label="Навигация сценария" className="studio-actions"><Link className="button secondary" href={`/dashboard?organization=${tenantId}`}>Поиск по организации</Link><Link className="button secondary" href={`/brands/${brandId}/content?organization=${tenantId}&tab=scripts`}>Открыть студию сценариев</Link></nav>
    <header><p className="page-eyebrow">{script.brandName}</p><h1>{script.title}</h1><p>Текущая версия {script.currentVersion} · {script.platform} · {script.duration} сек.</p><p>{script.approvedVersion===script.currentVersion?'Текущая версия одобрена':'Текущая версия не одобрена'}</p></header>
    <p className="notice">Только просмотр. Здесь показана сохранённая текущая версия сценария. Редактирование и одобрение доступны отдельно в студии согласно вашим правам.</p>
    <article aria-label="Текст сценария" className="panel stack">{fields.map(([key,label])=><section key={key}><h2>{label}</h2><p className="preserve-lines">{script.content[key]}</p></section>)}</article>
    <section className="panel" aria-label="Проверка фактов"><h2>Проверка фактов</h2>{script.content.factCheckNotes.length?<ul>{script.content.factCheckNotes.map((note,index)=><li key={index} className="preserve-lines">{note}</li>)}</ul>:<p>Нет сохранённых заметок. Это не подтверждение достоверности утверждений.</p>}</section>
  </section>;
}
