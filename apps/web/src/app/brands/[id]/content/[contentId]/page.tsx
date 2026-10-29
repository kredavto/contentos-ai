import {cookies} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import Link from 'next/link';
import {z} from 'zod';
import {DomainError} from '@contentos/types';
import {services,sessionCookie} from '../../../../../server/services';
export const dynamic='force-dynamic';
export default async function ContentDetailPage({params,searchParams}:{params:Promise<{id:string;contentId:string}>;searchParams:Promise<{organization?:string|string[]}>}){
  const app=services();
  const user=await app.auth.session((await cookies()).get(sessionCookie)?.value);
  if(!user)redirect('/login');
  const {id,contentId}=await params;const {organization}=await searchParams;
  const scope=z.object({tenantId:z.uuid(),brandId:z.uuid(),contentId:z.uuid()}).safeParse({tenantId:organization,brandId:id,contentId});
  if(!scope.success)notFound();
  const {tenantId,brandId}=scope.data;
  const item=await app.generation.currentContent(user.userId,tenantId,brandId,contentId).catch((error:unknown)=>{
    if(error instanceof DomainError&&(error.code==='NOT_FOUND'||error.code==='NOT_AUTHORIZED'))notFound();
    throw error;
  });
  if(item.role==='CLIENT_APPROVER')redirect(`/approvals?organization=${tenantId}`);
  const {detail}=item;
  const text=detail.kind==='POST'||detail.kind==='CAROUSEL'?detail.content:null;
  return <section aria-label="Просмотр материала" className="page-container stack" style={{overflowWrap:'anywhere'}}>
    <nav aria-label="Навигация материала" className="studio-actions"><Link className="button secondary" href={`/dashboard?organization=${tenantId}`}>Поиск по организации</Link><Link className="button secondary" href={`/brands/${brandId}/content?organization=${tenantId}&tab=${item.type==='POST'?'posts':item.type==='CAROUSEL'?'carousels':'calendar'}`}>Открыть раздел материалов</Link></nav>
    <header><p className="page-eyebrow">{item.brandName}</p><h1>{item.title}</h1><p>Тип: {item.type} · Статус материала: {item.status}</p></header>
    <p className="notice">Только просмотр сохранённых данных. Обновление страницы повторно проверяет доступ и получает текущую версию. Редактирование, одобрение, генерация и публикация здесь недоступны. Статус материала не подтверждает его текущее состояние на внешней платформе.</p>
    {detail.kind==='POST'||detail.kind==='CAROUSEL'?<>
      <p>{detail.platform} · Текущая версия текста: {detail.version}</p>
      <p>{detail.approvedVersion===detail.version?'Текущая версия одобрена':'Текущая версия не одобрена'}</p>
    </>:null}
    {detail.kind==='CAROUSEL'?<p>{detail.archivedAt?'Карусель в архиве':'Карусель активна'} · Ревизия состояния: {detail.lifecycleRevision}</p>:null}
    {detail.kind==='NO_TEXT'?<p className="panel">Для этого материала ещё нет сохранённого текста соответствующего типа. Другой материал или старая версия не подставляются.</p>:null}
    {detail.kind==='METADATA_ONLY'?<p className="panel">Для этого типа здесь показаны только сведения о материале. Медиафайлы, предпросмотр и содержимое связанных сценариев не загружаются.</p>:null}
    {text?<article aria-label="Текст материала" className="panel stack"><h2>{text.title}</h2>
      {detail.kind==='POST'?<p className="preserve-lines">{detail.content.body}</p>:null}
      {detail.kind==='CAROUSEL'?<><p>Показан текст слайдов, не графический экспорт карусели.</p>{detail.content.slides.map((slide,index)=><section key={index}><h3>Слайд {index+1}: {slide.heading}</h3><p className="preserve-lines">{slide.body}</p></section>)}<section><h3>Подпись</h3><p className="preserve-lines">{detail.content.caption}</p></section></>:null}
      {text.hashtags.length?<p>{text.hashtags.map(tag=>`#${tag}`).join(' ')}</p>:null}
    </article>:null}
    {text?<section className="panel" aria-label="Проверка фактов"><h2>Проверка фактов</h2>{text.factCheckNotes.length?<ul>{text.factCheckNotes.map((note,index)=><li key={index} className="preserve-lines">{note}</li>)}</ul>:<p>Нет сохранённых заметок. Это не подтверждение достоверности утверждений.</p>}</section>:null}
  </section>;
}
