'use client';
import {useRef,useState} from 'react';
import type {AccountErasureRecoveryInput} from '@contentos/types';
import {api} from '../lib/api-client';
export function AccountErasureRecovery({id,recoveryId,onRecovered}:{id:string;recoveryId:string|null;onRecovered:()=>Promise<void>}){
 const [reason,setReason]=useState<AccountErasureRecoveryInput['reason']>('DEPENDENCIES_RESOLVED'),[ticket,setTicket]=useState(''),[acknowledged,setAcknowledged]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
 const intent=useRef<string|null>(null);
 function changed(){intent.current=null;setError('');}
 async function submit(){
  setPending(true);setError('');intent.current??=crypto.randomUUID();
  try{await api(`admin/account-erasures/${id}/retry`,'POST',{expectedRecoveryId:recoveryId,idempotencyKey:intent.current,reason,ticket,acknowledgeOriginalScope:true});await onRecovered();}
  catch(failure){setError(failure instanceof Error?failure.message:'Не удалось возобновить операцию');}finally{setPending(false);}
 }
 return <form className="panel" aria-label="Возобновление удаления профиля" onSubmit={event=>{event.preventDefault();if(acknowledged)void submit();}}>
  <h3>Возобновить подтверждённую операцию</h3>
  <p>Возобновится удаление профиля и данных входа. Зависимости и незавершённые письма будут проверены повторно.</p>
  <label>Причина<select aria-label="Причина" value={reason} disabled={pending} onChange={event=>{setReason(event.target.value as AccountErasureRecoveryInput['reason']);changed();}}><option value="DEPENDENCIES_RESOLVED">Зависимости устранены</option><option value="TRANSIENT_FAILURE_RESOLVED">Временный сбой устранён</option></select></label>
  <label>Номер обращения<input value={ticket} required pattern={'[A-Za-z0-9_\\-]{3,80}'} minLength={3} maxLength={80} disabled={pending} onChange={event=>{setTicket(event.target.value);changed();}}/></label>
  <label><input type="checkbox" checked={acknowledged} disabled={pending} onChange={event=>{setAcknowledged(event.target.checked);changed();}}/>Подтверждаю сохранение исходного объёма согласия пользователя</label>
  <button className="button secondary" disabled={pending||!acknowledged||!ticket}>{pending?'Возобновляем…':'Возобновить удаление профиля'}</button>
  {error?<p role="alert">{error}</p>:null}
 </form>;
}
