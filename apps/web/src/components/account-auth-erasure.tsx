'use client';
import {useEffect,useRef,useState} from 'react';
import type {AccountErasureService} from '@contentos/core';
import {api} from '../lib/api-client';
type Eligibility=Awaited<ReturnType<AccountErasureService['eligibility']>>;
export function AccountAuthErasure({request,onClosed}:{request:{id:string;revision:string};onClosed:(id:string)=>void}){
 const [eligibility,setEligibility]=useState<Eligibility|null>(null),[error,setError]=useState(''),[password,setPassword]=useState(''),[irreversible,setIrreversible]=useState(false),[retained,setRetained]=useState(false),[pending,setPending]=useState(false),[reload,setReload]=useState(0);
 const intent=useRef<string|null>(null);
 useEffect(()=>{const controller=new AbortController();setEligibility(null);api<Eligibility>('privacy/erasure','GET',undefined,controller.signal).then(result=>{if(!controller.signal.aborted){setEligibility(result);setError('');}}).catch(failure=>{if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Не удалось проверить доступность');});return()=>controller.abort();},[request.id,reload]);
 async function erase(){setPending(true);setError('');try{intent.current??=crypto.randomUUID();const result=await api<{id:string;status:string}>('privacy/erasure','POST',{password,requestId:request.id,revision:request.revision,idempotencyKey:intent.current,scope:'ACCOUNT_AUTH_DATA_V1',acknowledgeIrreversible:irreversible,acknowledgeRetainedEvidence:retained});setPassword('');setPending(false);onClosed(result.id);return;}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось закрыть доступ');}setPassword('');setPending(false);}
 return <section className="panel brand-profile-editor" aria-label="Удаление профиля и данных входа"><h2>Закрыть доступ и удалить профиль</h2><p>Отдельное необратимое действие для аккаунтов без связанных организаций и ресурсов: имя, email, пароль, сессии, ссылки подтверждения и сброса пароля, а также сохранённые в сервисе данные служебных писем будут удалены или заменены обезличенной записью. Сначала будут закрыты все сессии, затем данные будут обработаны в фоне.</p><p>Журнал действий и подтверждения запроса сохраняют технический ID. Материалы организаций, медиа, финансовые документы и копии данных в общих материалах этим действием не удаляются. При наличии зависимостей нужна ручная обработка.</p>
  {!eligibility&&!error?<p role="status">Проверяем зависимости аккаунта…</p>:null}{error?<p role="alert">{error}</p>:null}
  {eligibility&&!eligibility.available?<p>Удаление данных входа пока не включено администратором.</p>:null}
  {eligibility&&!eligibility.eligible?<p>Нужна ручная обработка: у аккаунта есть связанные данные или незавершённая отправка письма. Доступ пока сохранён.</p>:null}
  <button className="button secondary" disabled={pending} onClick={()=>setReload(value=>value+1)}>Проверить зависимости снова</button>
  <form onSubmit={event=>{event.preventDefault();void erase();}}>
   <label>Пароль для закрытия аккаунта<input type="password" autoComplete="current-password" required maxLength={128} value={password} disabled={pending} onChange={event=>setPassword(event.target.value)}/></label>
   <label className="consent-checkbox"><input type="checkbox" checked={irreversible} disabled={pending} onChange={event=>setIrreversible(event.target.checked)}/>Подтверждаю необратимое удаление профиля и данных входа и выход на всех устройствах</label>
   <label className="consent-checkbox"><input type="checkbox" checked={retained} disabled={pending} onChange={event=>setRetained(event.target.checked)}/>Понимаю состав удаления и сохранение технического журнала и общих данных</label>
   <button className="button primary" disabled={pending||!eligibility?.available||!eligibility.eligible||!password||!irreversible||!retained}>Закрыть аккаунт и удалить данные входа</button>
  </form>
 </section>;
}
