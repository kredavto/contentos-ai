'use client';
import {useEffect,useId,useState} from 'react';
import {api} from '../lib/api-client';
type Preferences={emailEnabled:boolean;revision:string|null;deliveryStatus:'READY'|'CONFIGURATION_REQUIRED'};
export function NotificationPreferences({tenantId}:{tenantId:string}){
  const id=useId(),[value,setValue]=useState<Preferences|null>(null),[enabled,setEnabled]=useState(false),[pending,setPending]=useState(true),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const endpoint=`organizations/${tenantId}/notifications/preferences`;
  useEffect(()=>{let active=true;api<Preferences>(endpoint).then(result=>{if(active){setValue(result);setEnabled(result.emailEnabled);}}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить настройки');}).finally(()=>{if(active)setPending(false);});return()=>{active=false;};},[endpoint]);
  async function save(){
    if(!value||pending)return;setPending(true);setError('');setSaved(false);
    try{const result=await api<{emailEnabled:boolean;revision:string|null}>(endpoint,'PUT',{emailEnabled:enabled,revision:value.revision});setValue({...value,...result});setEnabled(result.emailEnabled);setSaved(true);}
    catch(failure){setError(failure instanceof Error?failure.message:'Не удалось сохранить настройки');}
    finally{setPending(false);}
  }
  return <section className="panel stack" aria-label="Почтовые уведомления"><h2>Почтовые уведомления</h2><p>Подписка действует только для вашего аккаунта в этой организации. Письма о событиях до включения подписки не отправляются.</p>{value?.deliveryStatus==='CONFIGURATION_REQUIRED'&&<p role="status">Почтовый канал ещё не настроен. Можно сохранить подписку; отправка станет доступна после подключения почты.</p>}<label className="consent-checkbox" htmlFor={id}><input id={id} type="checkbox" checked={enabled} disabled={!value||pending} onChange={event=>{setEnabled(event.target.checked);setSaved(false);}}/> Получать новые уведомления по email</label><button className="button secondary" disabled={!value||pending||enabled===value.emailEnabled} onClick={()=>void save()}>Сохранить подписку</button>{saved&&<p role="status">{value?.emailEnabled?'Подписка сохранена.':'Почтовые уведомления отключены.'}</p>}{error&&<p role="alert">{error}. Обновите страницу, чтобы загрузить актуальные настройки.</p>}</section>;
}
