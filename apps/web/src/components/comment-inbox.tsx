'use client';
import {useEffect,useRef,useState} from 'react';
import type {AnalyticsService,CommentService,CommentImportService} from '@contentos/core';
import {api} from '../lib/api-client';
type List=Awaited<ReturnType<CommentService['list']>>;
type Sync=Awaited<ReturnType<CommentImportService['latest']>>;
type Page=List&{sync:Sync};
type Status=List['items'][number]['status'];
const labels:Record<Status,string>={NEW:'Новый',NEEDS_HUMAN:'Требует человека',RESOLVED:'Разобран'};
const states={QUEUED:'Импорт в очереди',RUNNING:'Получаем комментарии',PARTIAL:'Импорт частично выполнен',SUCCEEDED:'Импорт завершён',FAILED:'Импорт не завершён из-за ошибки',CANCELLED:'Импорт остановлен'};
export function CommentInbox({base,canManage}:{base:string;canManage:boolean}){
 const [rows,setRows]=useState<Awaited<ReturnType<AnalyticsService['overview']>>|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const controller=new AbortController();api<Awaited<ReturnType<AnalyticsService['overview']>>>(`${base}/analytics`,'GET',undefined,controller.signal).then(data=>{setRows(data.filter(row=>row.provider==='youtube'));setError('');}).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'Не удалось загрузить публикации');});return()=>controller.abort();},[base,refresh]);
 return <section className="stack" aria-label="Комментарии YouTube"><h2>Комментарии</h2><p>Читайте комментарии и отмечайте вопросы для ручной обработки. Ответы и автоматическая отправка пока недоступны.</p>
  {error?<p role="alert">{error}</p>:null}<button className="button secondary" onClick={()=>setRefresh(value=>value+1)}>Обновить публикации</button>
  {!rows&&!error?<p role="status">Загружаем публикации…</p>:null}
  {rows?.length===0?<p className="notice">Пока нет сохранённых публикаций YouTube этого бренда.</p>:null}
  {rows?.length?<><p className="muted">Выберите видео из последних 100 публикаций бренда, сохранённых в приложении.</p><label>Публикация для комментариев<select value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Выберите публикацию</option>{rows.map(row=><option key={row.id} value={row.id}>{row.title} · {new Date(row.publishedAt).toLocaleDateString('ru')}</option>)}</select></label></>:null}
  {selected?<CommentPages key={`${base}/${selected}`} endpoint={`${base}/publications/${selected}/comments`} canManage={canManage}/>:null}
 </section>;
}
function CommentPages({endpoint,canManage,parentId}:{endpoint:string;canManage:boolean;parentId?:string}){
 const [data,setData]=useState<Page|null>(null),[status,setStatus]=useState(''),[cursor,setCursor]=useState<List['next']>(null),[refresh,setRefresh]=useState(0),[error,setError]=useState(''),[pending,setPending]=useState(false),[opened,setOpened]=useState<string|null>(null),[notice,setNotice]=useState('');
 const intent=useRef<string|null>(null);
 useEffect(()=>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;setData(null);
  async function load(){try{
   const query=new URLSearchParams({...cursor,...(status?{status}:{}),...(parentId?{parentId}:{})});
   const result=await api<Page>(`${endpoint}?${query}`,'GET',undefined,controller.signal);
   if(controller.signal.aborted)return;setData(result);setError('');
   if(result.sync.job&&['QUEUED','RUNNING'].includes(result.sync.job.status))timer=setTimeout(()=>void load(),5000);
  }catch(failure){if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Не удалось загрузить комментарии');}}
  void load();return()=>{controller.abort();clearTimeout(timer);};
 },[endpoint,parentId,status,cursor,refresh]);
 async function perform(action:()=>Promise<unknown>){setPending(true);setError('');setNotice('');try{await action();setNotice('Изменения сохранены');setRefresh(value=>value+1);}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось выполнить действие');}finally{setPending(false);}}
 const job=data?.sync.job,busy=!!job&&['QUEUED','RUNNING'].includes(job.status),partial=job?.status==='PARTIAL';
 return <section className="stack" aria-label={parentId?'Ответы на комментарий':'Список комментариев'}>
  {!parentId?<><p className="muted">Импорт сохраняет снимок обсуждения. Исчезнувшие из YouTube комментарии автоматически не удаляются. Ручная разметка сохраняется при обновлении.</p>
   {data?<p role="status">{job?`${states[job.status]} · страниц сохранено: ${job.completedPages}`:'Комментарии ещё не импортированы.'}</p>:null}
   {data&&!data.sync.configuration.ready?<p className="notice warning">Импорт не настроен на сервере. Сохранённые комментарии доступны для чтения.</p>:null}
   {job&&['PARTIAL','FAILED','CANCELLED'].includes(job.status)?<p className="notice warning">Список может быть неполным. Проверьте доступ к комментариям в разделе «Интеграции» и повторите импорт.{job.errorCode==='COMMENTS_DISABLED'?' Комментарии к этому видео отключены.':''}</p>:null}
   {canManage?<div className="studio-actions"><button className="button primary" disabled={pending||!data?.sync.configuration.ready||busy||partial} onClick={()=>void perform(async()=>{intent.current??=crypto.randomUUID();await api(`${endpoint}/imports`,'POST',{idempotencyKey:intent.current});intent.current=null;})}>Импортировать комментарии</button>
    {partial?<button className="button secondary" disabled={pending||!data?.sync.configuration.ready} onClick={()=>void perform(()=>api(`${endpoint}/imports/${job.id}/resume`,'POST',{revision:job.revision}))}>Продолжить импорт</button>:null}
    {job&&(busy||partial)?<button className="button secondary" disabled={pending} onClick={()=>void perform(()=>api(`${endpoint}/imports/${job.id}/cancel`,'POST',{revision:job.revision}))}>Остановить импорт</button>:null}</div>:null}</>:null}
  <div className="studio-actions"><label>Статус {parentId?'ответов':'комментариев'}<select value={status} disabled={pending} onChange={event=>{setStatus(event.target.value);setCursor(null);setOpened(null);}}><option value="">Все</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><button className="button secondary" disabled={pending} onClick={()=>setRefresh(value=>value+1)}>Обновить список</button></div>
  {error?<p role="alert" className="notice error">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}{!data&&!error?<p role="status">Загружаем комментарии…</p>:null}
  {data?.items.length===0?<p>В этой выборке нет сохранённых комментариев.{data.sync.job?.status!=='SUCCEEDED'?' Полнота импорта не подтверждена.':''}</p>:null}
  {data?.items.map(row=><article className="panel stack" key={row.id}><strong>{row.authorName||'Автор недоступен'}</strong><small>{new Date(row.providerCreatedAt).toLocaleString('ru')} · {labels[row.status]}</small><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{row.text||'Пустой текст комментария'}</p>
   {canManage?<label>Разметка комментария<select aria-label={`Разметка: ${row.authorName||'автор недоступен'}`} value={row.status} disabled={pending} onChange={event=>void perform(()=>api(`${endpoint}/${row.id}`,'PATCH',{revision:row.revision,contentRevision:row.contentRevision,status:event.target.value}))}>{Object.entries(labels).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label>:null}
   {!parentId?<><button className="text-button" aria-expanded={opened===row.id} onClick={()=>setOpened(opened===row.id?null:row.id)}>{opened===row.id?'Скрыть ответы':`Показать ответы (${row.replyCount??'неизвестно'})`}</button>{opened===row.id?<CommentPages key={row.id} endpoint={endpoint} canManage={canManage} parentId={row.id}/>:null}</>:null}
  </article>)}
  <div className="studio-actions">{cursor?<button className="button secondary" disabled={pending} onClick={()=>{setCursor(null);setOpened(null);}}>К началу списка</button>:null}{data?.next?<button className="button secondary" disabled={pending} onClick={()=>{setCursor(data.next);setOpened(null);}}>Следующая страница</button>:null}</div>
 </section>;
}
