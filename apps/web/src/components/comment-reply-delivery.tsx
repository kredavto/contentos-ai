'use client';
import {useEffect,useRef,useState} from 'react';
import type {CommentDeliveryService} from '@contentos/core';
import {api} from '../lib/api-client';
type Status=Awaited<ReturnType<CommentDeliveryService['latest']>>;
const labels={QUEUED:'В очереди отправки',ATTEMPTED:'Отправка выполняется',REJECTED:'Отправка отклонена',RECONCILIATION_REQUIRED:'Результат неизвестен — требуется сверка',SUCCEEDED:'Ответ опубликован'};
export function CommentReplyDelivery({endpoint,approvalId,canSend}:{endpoint:string;approvalId:string|null;canSend:boolean}){
 const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[readError,setReadError]=useState(''),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState(false),[reload,setReload]=useState(0);
 const intent=useRef<{approvalId:string;key:string}|null>(null);
 useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;async function poll(){try{const result=await api<Status>(`${endpoint}/delivery`,'GET',undefined,controller.signal);if(!controller.signal.aborted){setStatus(result);setReadError('');}}catch(failure){if(!controller.signal.aborted)setReadError(failure instanceof Error?failure.message:'Не удалось проверить отправку');}finally{if(!controller.signal.aborted)timer=setTimeout(()=>void poll(),4000);}}void poll();return()=>{controller.abort();clearTimeout(timer);};},[endpoint,reload]);
 async function send(){if(!approvalId)return;setPending(true);setError('');try{if(intent.current?.approvalId!==approvalId)intent.current={approvalId,key:crypto.randomUUID()};await api(`${endpoint}/delivery`,'POST',{approvalId,idempotencyKey:intent.current.key,confirmSend:confirmed});setConfirmed(false);setStatus(null);setReload(value=>value+1);}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось запросить отправку');}finally{setPending(false);}}
 const blocked=!!status?.job&&['QUEUED','ATTEMPTED','RECONCILIATION_REQUIRED','SUCCEEDED'].includes(status.job.status);
 return <section className="stack" aria-label="Отправка ответа"><h4>Отправка в YouTube</h4>
  {!status&&!readError?<p role="status">Проверяем отправку…</p>:null}
  {readError?<p role="alert">{readError} Отправка заблокирована до проверки статуса.</p>:null}{error?<p role="alert">{error}</p>:null}
  {status?.job?<p role="status">{labels[status.job.status]}</p>:null}
  {status?.job?.status==='RECONCILIATION_REQUIRED'?<p>Ответ мог быть опубликован. Повторная отправка заблокирована до сверки результата.</p>:null}
  {status&&!status.configuration.ready?<p>Для отправки требуется настройка подключения YouTube на сервере.</p>:null}
  {canSend?<><label><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={pending||blocked||!approvalId}/>Опубликовать сохранённую одобренную версию ответа в YouTube</label><button className="button primary" disabled={pending||!status||!!readError||!status.configuration.ready||!approvalId||!confirmed||blocked} onClick={()=>void send()}>Отправить одобренный ответ</button></>:null}
 </section>;
}
