'use client';
import {useCallback,useEffect,useState} from 'react';
import Link from 'next/link';
import type {ScriptOutput,PostOutput,CarouselOutput,ApprovalDecision} from '@contentos/types';
import {ApprovalMaterial} from './approval-material';
import {api} from '../lib/api-client';
type Row={targetChanged:boolean;id:string;brandId:string;version:number;requestedBy:string;requestedFrom:string;requestComment:string;status:string;comment:string|null;title:string;currentVersion:number;approvedVersion:number|null;archived:boolean;lifecycleRevision:number|null;requestedLifecycleRevision:number|null}&({entityType:'SCRIPT';content:ScriptOutput}|{entityType:'POST';content:PostOutput}|{entityType:'CAROUSEL';content:CarouselOutput}|{entityType:'IMAGE';content:null});
type Page={items:Row[];nextCursor:string|null;userId:string;role:string};
const labels:Record<string,string>={PENDING:'Ожидает решения',APPROVED:'Одобрен',REJECTED:'Отклонён',CHANGES_REQUESTED:'Нужны изменения',CANCELLED:'Отменён'};
function ApprovalCard({tenantId,row,page,onDecision,pending}:{tenantId:string;row:Row;page:Page;onDecision:(id:string,input:ApprovalDecision)=>Promise<void>;pending:boolean}){
  const [comment,setComment]=useState('');const stale=row.targetChanged||row.currentVersion!==row.version||row.approvedVersion===row.version||row.archived||row.lifecycleRevision!==row.requestedLifecycleRevision;
  const canDecide=row.status==='PENDING'&&row.requestedFrom===page.userId&&['OWNER','ADMIN','MANAGER','CLIENT_APPROVER'].includes(page.role)&&!stale;
  const canCancel=row.status==='PENDING'&&(row.requestedBy===page.userId||['OWNER','ADMIN','MANAGER'].includes(page.role));
  return <article className="panel stack"><h2>{row.title} · v{row.version}</h2><span className="badge">{labels[row.status]}</span><p className="preserve-lines">{row.requestComment}</p><ApprovalMaterial value={row} tenantId={tenantId} requestId={row.id}/>{row.status==='PENDING'&&stale?<p className="notice warning">Материал изменился, архивирован или уже одобрен. Отмените запрос и при необходимости создайте новый.</p>:null}{row.comment?<p className="preserve-lines">Решение: {row.comment}</p>:null}
    {canDecide||canCancel?<label>Комментарий к решению<textarea value={comment} maxLength={2000} onChange={event=>setComment(event.target.value)}/></label>:null}
    <div className="studio-actions">{canDecide?(['APPROVED','REJECTED','CHANGES_REQUESTED'] as const).map(status=><button key={status} className="button secondary" disabled={pending||(status!=='APPROVED'&&!comment.trim())} onClick={()=>void onDecision(row.id,{status,comment})}>{status==='APPROVED'?'Одобрить версию':status==='REJECTED'?'Отклонить':'Запросить изменения'}</button>):null}{canCancel?<button className="button secondary" disabled={pending} onClick={()=>void onDecision(row.id,{status:'CANCELLED',comment})}>Отменить запрос</button>:null}</div>
    <Link href={`/brands/${row.brandId}/content?organization=${tenantId}&tab=${row.entityType==='SCRIPT'?'scripts':row.entityType==='POST'?'posts':row.entityType==='IMAGE'?'images':'carousels'}`}>Открыть материалы бренда</Link>
  </article>;
}
export function ApprovalInbox({tenantId}:{tenantId:string}){
  const [page,setPage]=useState<Page|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false),[cursor,setCursor]=useState<string|null>(null);
  const load=useCallback(async()=>{setPage(await api<Page>(`organizations/${tenantId}/approvals${cursor?`?cursor=${cursor}`:''}`));},[tenantId,cursor]);
  useEffect(()=>{let active=true;api<Page>(`organizations/${tenantId}/approvals${cursor?`?cursor=${cursor}`:''}`).then(value=>{if(active)setPage(value);}).catch(failure=>{if(active)setError(failure.message);});return()=>{active=false;};},[tenantId,cursor]);
  async function decide(id:string,input:ApprovalDecision){setPending(true);setError('');try{await api(`organizations/${tenantId}/approvals/${id}`,'POST',input);await load();}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось сохранить решение');}finally{setPending(false);}}
  return <main className="page-container"><h1>Согласования материалов</h1><p>Запросы привязаны к сохранённой версии. Одобрение не запускает генерацию или публикацию.</p><Link href={`/dashboard?organization=${tenantId}`}>К организации</Link>{error?<p role="alert" className="notice error">{error}</p>:null}<button className="button secondary" disabled={pending} onClick={()=>{setError('');void load().catch(failure=>setError(failure.message));}}>Обновить согласования</button>{!page?<p role="status">Загружаем…</p>:!page.items.length?<p>Запросов нет.</p>:page.items.map(row=><ApprovalCard tenantId={tenantId} key={row.id} row={row} page={page} pending={pending} onDecision={decide}/>)}{page?.nextCursor?<button className="button secondary" onClick={()=>{setPage(null);setCursor(page.nextCursor);}}>Более ранние запросы</button>:null}</main>;
}
