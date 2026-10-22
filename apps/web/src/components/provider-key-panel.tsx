'use client';
import {useEffect,useState} from 'react';
import type {ProviderKeyService} from '@contentos/core';
import {api} from '../lib/api-client';
type Overview=Awaited<ReturnType<ProviderKeyService['overview']>>;
export function ProviderKeyPanel({base}:{base:string}){
 const [data,setData]=useState<Overview|null>(null),[secret,setSecret]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[cursor,setCursor]=useState<string|null>(null);
 const endpoint=`${base}/provider-keys`,key=data?.keys.find(item=>item.provider==='heygen');
 useEffect(()=>{let active=true;api<Overview>(endpoint).then(value=>{if(active)setData(value);}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить подключение');});return()=>{active=false;};},[endpoint]);
 async function perform(action:()=>Promise<void>){if(pending)return;setPending(true);setError('');setNotice('');try{await action();}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось выполнить действие');}finally{setPending(false);}}
 async function reload(){setData(await api<Overview>(endpoint));setCursor(null);}
 return <section className="panel stack" aria-label="Свой ключ HeyGen"><h3>Свой ключ HeyGen</h3><p>Доступен владельцу на тарифах Expert и Agency. Сейчас ключ используется только для загрузки публичного каталога голосов. Создание аватаров и видео по-прежнему использует подключение платформы.</p>
 {data&&!data.configuration.ready?<p role="status">Хранилище ключей ещё не настроено. Сохранение недоступно.</p>:null}
 {key?<p>{key.status==='ACTIVE'?'Ключ сохранён':'Ключ отозван'}: <span>{key.maskedKey}</span>. Сохранение не подтверждает доступ к API HeyGen.</p>:null}
 <form className="stack" onSubmit={event=>{event.preventDefault();const apiKey=secret;setSecret('');void perform(async()=>{await api(endpoint,'PUT',{provider:'heygen',apiKey,revision:key?.revision??null});await reload();setNotice('Ключ сохранён в зашифрованном виде. Можно проверить загрузку каталога.');});}}>
 <label>API-ключ HeyGen<input type="password" autoComplete="off" spellCheck={false} minLength={20} maxLength={4096} required value={secret} onChange={event=>setSecret(event.target.value)} disabled={pending||!data?.configuration.ready}/></label>
 <button className="button secondary" disabled={pending||!data?.configuration.ready||secret.length<20}>{key?'Заменить ключ HeyGen':'Сохранить ключ HeyGen'}</button></form>
 {key?.status==='ACTIVE'?<div className="studio-actions"><button className="button secondary" disabled={pending} onClick={()=>void perform(async()=>{const result=await api<{nextCursor:string|null}>(`${base}/voices`,'POST',{connection:{id:key.id,revision:key.revision},...(cursor?{cursor}:{})});setCursor(result.nextCursor);setNotice('Публичные голоса загружены через ваш ключ HeyGen.');})}>{cursor?'Загрузить ещё через свой ключ':'Загрузить голоса через свой ключ'}</button><button className="text-button" disabled={pending} onClick={()=>void perform(async()=>{await api(`${endpoint}/${key.id}/revoke`,'POST',{revision:key.revision});await reload();setNotice('Ключ удалён из хранилища. Для повторного подключения введите его заново.');})}>Отозвать ключ HeyGen</button></div>:null}
 <button className="text-button" disabled={pending} onClick={()=>void perform(reload)}>Обновить состояние подключения</button>
 <p className="muted">Отзыв удаляет сохранённый секрет из приложения. Он не удаляет ключ в аккаунте HeyGen и не отменяет уже отправленный запрос. Запрос удаления аккаунта пока не выполняет удаление данных автоматически.</p>
 {error?<p role="alert">{error}. Если состояние изменилось в другой вкладке, обновите подключение.</p>:null}{notice?<p role="status">{notice}</p>:null}</section>;
}
