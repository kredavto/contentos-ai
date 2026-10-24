'use client';
import {useEffect,useState,useRef} from 'react';
import type {CommentReplyService,GenerationService} from '@contentos/core';
import {api} from '../lib/api-client';
type History=Awaited<ReturnType<CommentReplyService['history']>>;
type Generation=Awaited<ReturnType<GenerationService['overview']>>;
type Props={endpoint:string;base:string;publicationId:string;commentId:string;generation:Generation|null;canManage:boolean;contentRevision:number;reviewRevision:number};
export function CommentReplyEditor(props:Props){
 const [open,setOpen]=useState(false);
 return <div className="stack"><button className="text-button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Закрыть черновик':'Черновик ответа и история'}</button>{open?<Editor {...props}/>:null}</div>;
}
function Editor({endpoint,base,publicationId,commentId,generation,canManage,contentRevision,reviewRevision}:Props){
 const [history,setHistory]=useState<History|null>(null),[reply,setReply]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false),[reload,setReload]=useState(0);
 const intent=useRef<{payload:string;key:string}|null>(null);
 const [requested,setRequested]=useState<string|null>(null);
 const job=generation?.jobs.find(row=>row.type==='DRAFT_COMMENT_REPLY'&&row.commentId===commentId);
 const busy=!!job&&['QUEUED','RUNNING','RETRY'].includes(job.status);
 const awaiting=!!requested&&!generation?.jobs.some(row=>row.id===requested);
 const price=generation?.usage.policies.find(row=>row.operation==='DRAFT_COMMENT_REPLY');
 const [source]=useState({contentRevision,reviewRevision});
 const changed=source.contentRevision!==contentRevision||source.reviewRevision!==reviewRevision;
 useEffect(()=>{const controller=new AbortController();setHistory(null);api<History>(endpoint,'GET',undefined,controller.signal).then(data=>{setHistory(data);setReply(data.items[0]?.content.reply??'');setError('');}).catch(failure=>{if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Не удалось загрузить черновик');});return()=>controller.abort();},[endpoint,reload]);
 async function save(){if(!history)return;setPending(true);setError('');setNotice('');try{
  const result=await api<{id:string;revision:number;currentVersion:number}>(endpoint,'POST',{revision:history.draft?.revision??null,...source,reply});
  // Record accepted revision immediately even if the following history read fails.
  setHistory({...history,draft:result});setNotice('Черновик сохранён. В YouTube ничего не отправлено.');setReload(value=>value+1);
 }catch(failure){setError(failure instanceof Error?failure.message:'Не удалось сохранить. Обновите список комментариев и откройте черновик снова.');}finally{setPending(false);}}
 async function generate(){if(!history)return;setPending(true);setError('');try{
  const options={commentReply:{publicationId,commentId,...source,draftRevision:history.draft?.revision??null}};
  const payload=JSON.stringify(options);if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};
  const result=await api<{id:string}>(`${base}/jobs`,'POST',{type:'DRAFT_COMMENT_REPLY',options,idempotencyKey:intent.current.key});
  setRequested(result.id);intent.current=null;setNotice('Задание принято. Несохранённый текст не используется для генерации.');
 }catch(failure){setError(failure instanceof Error?failure.message:'Не удалось запросить AI-черновик');}finally{setPending(false);}}
 async function more(){if(!history?.next)return;setPending(true);setError('');try{const page=await api<History>(`${endpoint}?beforeVersion=${history.next.beforeVersion}`);setHistory({...history,items:[...history.items,...page.items],next:page.next});}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось загрузить историю');}finally{setPending(false);}}
 return <section className="stack" aria-label="Редактор черновика ответа"><p className="notice">Черновик хранится в приложении. Согласование и отправка ответа пока недоступны.</p>
  {error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  {!history&&!error?<p role="status">Загружаем историю черновика…</p>:null}
  {changed?<p className="notice warning">Комментарий изменился. Скопируйте несохранённый текст, обновите список и откройте черновик снова.</p>:null}
  {canManage?<div className="stack">{generation?.configuration.provider==='mock'?<p className="notice warning">ДЕМО: ответ создаёт тестовый провайдер, не AI.</p>:null}<button className="button secondary" disabled={!history||pending||changed||busy||awaiting||!generation?.configuration.ready||!price} onClick={()=>void generate()}>Предложить AI-ответ{price?` · ${price.amount} кр.`:''}</button><small>AI использует сохранённый комментарий и Brand Brain. Результат не отправляется и не заменяет несохранённый текст.</small>
   {busy||awaiting?<p role="status">AI-черновик в работе…</p>:null}
   {job?.status==='SUCCEEDED'?<p role="status">AI-черновик готов. Нажмите «Загрузить последнюю версию», чтобы просмотреть и проверить его.</p>:null}
   {job?.status==='FAILED'?<p role="alert">AI-черновик не создан. Проверьте изменения комментария и черновика, затем загрузите последнюю версию перед повтором.</p>:null}
  </div>:null}
  {canManage?<><label>Текст черновика<textarea rows={5} maxLength={2000} value={reply} disabled={!history||pending} onChange={event=>setReply(event.target.value)}/></label><div className="studio-actions"><button className="button primary" disabled={!history||pending||changed||!reply.trim()} onClick={()=>void save()}>Сохранить черновик</button><button className="button secondary" disabled={pending} onClick={()=>setReload(value=>value+1)}>Загрузить последнюю версию</button></div><small>Загрузка последней версии заменяет несохранённый текст. После конфликта сначала сохраните свой текст отдельно.</small></>:null}
  {history?.items.length===0?<p>Сохранённых версий пока нет.</p>:null}
  {history?.items.map(version=><article className="panel" key={version.id}><h4>Версия {version.version} · {version.source==='HUMAN'?'Ручной черновик':'AI-предложение'}</h4>{version.stale?<p className="notice warning">Исходный комментарий или его разметка изменились.</p>:null}<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{version.content.reply??'Текст ответа не предложен — требуется человек.'}</p>{version.content.risks.map(risk=><p key={risk.category}>Требуется проверка: {risk.reason}</p>)}</article>)}
  {history?.next?<button className="button secondary" disabled={pending} onClick={()=>void more()}>Более ранние версии</button>:null}
 </section>;
}
