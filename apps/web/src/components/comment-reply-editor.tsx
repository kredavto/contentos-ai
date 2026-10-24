'use client';
import {useEffect,useState} from 'react';
import type {CommentReplyService} from '@contentos/core';
import {api} from '../lib/api-client';
type History=Awaited<ReturnType<CommentReplyService['history']>>;
export function CommentReplyEditor({endpoint,canManage,contentRevision,reviewRevision}:{endpoint:string;canManage:boolean;contentRevision:number;reviewRevision:number}){
 const [open,setOpen]=useState(false);
 return <div className="stack"><button className="text-button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Закрыть черновик':'Черновик ответа и история'}</button>{open?<Editor endpoint={endpoint} canManage={canManage} contentRevision={contentRevision} reviewRevision={reviewRevision}/>:null}</div>;
}
function Editor({endpoint,canManage,contentRevision,reviewRevision}:{endpoint:string;canManage:boolean;contentRevision:number;reviewRevision:number}){
 const [history,setHistory]=useState<History|null>(null),[reply,setReply]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false),[reload,setReload]=useState(0);
 const [source]=useState({contentRevision,reviewRevision});
 const changed=source.contentRevision!==contentRevision||source.reviewRevision!==reviewRevision;
 useEffect(()=>{const controller=new AbortController();setHistory(null);api<History>(endpoint,'GET',undefined,controller.signal).then(data=>{setHistory(data);setReply(data.items[0]?.content.reply??'');setError('');}).catch(failure=>{if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Не удалось загрузить черновик');});return()=>controller.abort();},[endpoint,reload]);
 async function save(){if(!history)return;setPending(true);setError('');setNotice('');try{
  const result=await api<{id:string;revision:number;currentVersion:number}>(endpoint,'POST',{revision:history.draft?.revision??null,...source,reply});
  // Record accepted revision immediately even if the following history read fails.
  setHistory({...history,draft:result});setNotice('Черновик сохранён. В YouTube ничего не отправлено.');setReload(value=>value+1);
 }catch(failure){setError(failure instanceof Error?failure.message:'Не удалось сохранить. Обновите список комментариев и откройте черновик снова.');}finally{setPending(false);}}
 async function more(){if(!history?.next)return;setPending(true);setError('');try{const page=await api<History>(`${endpoint}?beforeVersion=${history.next.beforeVersion}`);setHistory({...history,items:[...history.items,...page.items],next:page.next});}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось загрузить историю');}finally{setPending(false);}}
 return <section className="stack" aria-label="Редактор черновика ответа"><p className="notice">Черновик хранится в приложении. Согласование и отправка ответа пока недоступны.</p>
  {error?<p role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
  {!history&&!error?<p role="status">Загружаем историю черновика…</p>:null}
  {changed?<p className="notice warning">Комментарий изменился. Скопируйте несохранённый текст, обновите список и откройте черновик снова.</p>:null}
  {canManage?<><label>Текст черновика<textarea rows={5} maxLength={2000} value={reply} disabled={!history||pending} onChange={event=>setReply(event.target.value)}/></label><div className="studio-actions"><button className="button primary" disabled={!history||pending||changed||!reply.trim()} onClick={()=>void save()}>Сохранить черновик</button><button className="button secondary" disabled={pending} onClick={()=>setReload(value=>value+1)}>Загрузить последнюю версию</button></div><small>Загрузка последней версии заменяет несохранённый текст. После конфликта сначала сохраните свой текст отдельно.</small></>:null}
  {history?.items.length===0?<p>Сохранённых версий пока нет.</p>:null}
  {history?.items.map(version=><article className="panel" key={version.id}><h4>Версия {version.version} · {version.source==='HUMAN'?'Ручной черновик':'AI-предложение'}</h4>{version.stale?<p className="notice warning">Исходный комментарий или его разметка изменились.</p>:null}<p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{version.content.reply??'Текст ответа не предложен — требуется человек.'}</p>{version.content.risks.map(risk=><p key={risk.category}>Требуется проверка: {risk.reason}</p>)}</article>)}
  {history?.next?<button className="button secondary" disabled={pending} onClick={()=>void more()}>Более ранние версии</button>:null}
 </section>;
}
