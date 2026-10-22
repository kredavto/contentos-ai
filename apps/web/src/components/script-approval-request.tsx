'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {api} from '../lib/api-client';
type ApprovalTarget={imageId:string;version:1}|{scriptId:string;version:number}|{postId:string;version:number}|{carouselId:string;version:number;lifecycleRevision:number};
export function ScriptApprovalRequest({tenantId,brandId,scriptId,version}:{tenantId:string;brandId:string;scriptId:string;version:number}){return <ContentApprovalRequest tenantId={tenantId} brandId={brandId} target={{scriptId,version}}/>;}
export function ContentApprovalRequest({tenantId,brandId,target}:{tenantId:string;brandId:string;target:ApprovalTarget}){
  const entityId='scriptId' in target?target.scriptId:'postId' in target?target.postId:'carouselId' in target?target.carouselId:target.imageId;
  const noun='scriptId' in target?'сценария':'postId' in target?'поста':'carouselId' in target?'карусели':'изображения';
  const [reviewers,setReviewers]=useState<Array<{id:string;name:string;role:string}>>([]),[reviewer,setReviewer]=useState(''),[comment,setComment]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false),[sent,setSent]=useState(false);
  const intent=useRef<{payload:string;key:string}|null>(null);
  useEffect(()=>{const controller=new AbortController();api<typeof reviewers>(`organizations/${tenantId}/approvals/reviewers`,'GET',undefined,controller.signal).then(setReviewers).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});return()=>controller.abort();},[tenantId]);
  async function request(){setPending(true);setError('');const data={...target,requestedFrom:reviewer,comment};const payload=JSON.stringify(data);if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};try{await api(`organizations/${tenantId}/brands/${brandId}/approval-requests`,'POST',{...data,idempotencyKey:intent.current.key});setSent(true);}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось отправить запрос');}finally{setPending(false);}}
  return <section aria-label={`Запрос согласования ${noun}`} className="panel stack"><h3>Запросить согласование версии {target.version}</h3>{sent?<p role="status">Запрос сохранён.</p>:<><label htmlFor={`reviewer-${entityId}`}>Согласующий</label><select id={`reviewer-${entityId}`} value={reviewer} onChange={event=>setReviewer(event.target.value)}><option value="">Выберите участника</option>{reviewers.map(item=><option key={item.id} value={item.id}>{item.name} · {item.role}</option>)}</select><label>Комментарий согласующему<textarea maxLength={2000} value={comment} onChange={event=>setComment(event.target.value)}/></label><button className="button secondary" disabled={pending||!reviewer} onClick={()=>void request()}>Отправить на согласование</button></>}{error?<p role="alert">{error}</p>:null}<Link href={`/approvals?organization=${tenantId}`}>Открыть согласования</Link></section>;
}

export function ImageApprovalRequest({tenantId,brandId,imageId}:{tenantId:string;brandId:string;imageId:string}){
  const [open,setOpen]=useState(false);
  return open?<ContentApprovalRequest tenantId={tenantId} brandId={brandId} target={{imageId,version:1}}/>:<button className="button secondary" onClick={()=>setOpen(true)}>Назначить согласующего</button>;
}
