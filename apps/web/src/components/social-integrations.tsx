'use client';
import {useEffect,useRef,useState} from 'react';
import type {SocialService} from '@contentos/core';
import {api} from '../lib/api-client';
type Overview=Awaited<ReturnType<SocialService['overview']>>;
const labels={PENDING:'Проверяется',CONNECTED:'Подключено',LIMITED:'Недостаточно прав',ACTIVE:'Готово',TOKEN_EXPIRED:'Токен недействителен',REVOKED:'Отключено',ERROR:'Ошибка проверки'};
export function SocialIntegrations({base,canManage}:{base:string;canManage:boolean}){
  const [data,setData]=useState<Overview|null>(null),[token,setToken]=useState(''),[target,setTarget]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false);
  const [replace,setReplace]=useState<Overview['connections'][number]|null>(null),[disconnect,setDisconnect]=useState<string|null>(null);
  const intent=useRef<{payload:string;key:string}|null>(null);
  useEffect(()=>{let active=true;api<Overview>(`${base}/social`).then(result=>{if(active)setData(result);}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить подключения');});return()=>{active=false;};},[base]);
  async function perform(action:()=>Promise<void>){setPending(true);setError('');setNotice('');try{await action();}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось выполнить действие');}finally{try{setData(await api<Overview>(`${base}/social`));}catch{setError('Не удалось обновить список подключений');}setPending(false);}}
  return <section className="stack"><h2>Социальные интеграции</h2><p className="muted">Подключите Telegram-канал через своего бота. Бот должен быть администратором с правом публикации. Проверка подключения ничего не публикует.</p>
    {error?<p className="notice error" role="alert">{error}</p>:null}{notice?<p className="notice success" role="status">{notice}</p>:null}
    {!data?<p role="status">Загружаем подключения…</p>:null}
    {data&&!data.configuration.ready?<p className="notice warning">Интеграция ещё не настроена на сервере. Требуется включить Telegram и настроить защищённое хранение токенов.</p>:null}
    {data?.configuration.provider==='mock-telegram'?<p className="notice warning">ДЕМО: проверка выполняется локально, соединения с Telegram нет.</p>:null}
    {canManage?<form className="panel stack" onSubmit={event=>{event.preventDefault();void perform(async()=>{
      if(replace)await api(`${base}/social/${replace.id}/reconnect`,'POST',{revision:replace.revision,token});
      else{const payload=JSON.stringify({token,target});if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};await api(`${base}/social`,'POST',{token,target,idempotencyKey:intent.current.key});}
      setToken('');setTarget('');setReplace(null);intent.current=null;setNotice('Подключение проверено. Результат показан ниже.');
    });}}><h3>{replace?`Обновить токен: ${replace.name}`:'Подключить Telegram-канал'}</h3>
      {!replace?<label>Канал Telegram<input aria-label="Канал Telegram" required maxLength={80} value={target} placeholder="@channel или числовой ID канала" onChange={event=>setTarget(event.target.value)}/></label>:null}
      <label>Токен Telegram-бота<input aria-label="Токен Telegram-бота" type="password" autoComplete="new-password" spellCheck={false} required maxLength={180} value={token} onChange={event=>setToken(event.target.value)}/></label>
      <p className="muted">Токен хранится в зашифрованном виде и не возвращается в браузер после сохранения.</p>
      <div className="studio-actions"><button className="button primary" disabled={pending||!data?.configuration.ready}>{replace?'Проверить новый токен':'Проверить и подключить'}</button>{replace?<button type="button" className="button secondary" disabled={pending} onClick={()=>{setReplace(null);setToken('');}}>Отмена замены</button>:null}</div>
    </form>:null}
    {data&&!data.connections.length?<div className="panel empty">Пока нет подключённых каналов.</div>:null}
    <div className="plan-grid">{data?.connections.map(connection=><article className="panel stack" key={connection.id}><span className="badge">{labels[connection.status]}</span><h3>{connection.name}</h3>{connection.username?<p>@{connection.username}</p>:null}<p className="muted">{connection.provider==='mock-telegram'?'Демонстрационный Telegram':'Telegram'} · {connection.lastCheckedAt?`Проверено ${new Date(connection.lastCheckedAt).toLocaleString('ru')}`:'Ещё не проверялось'}</p>
      {connection.status==='LIMITED'?<p className="notice warning">Проверьте, что бот — администратор канала и может публиковать сообщения. После изменения прав повторите проверку.</p>:null}
      {connection.status==='TOKEN_EXPIRED'?<p className="notice warning">Укажите действующий токен этого бота или другого бота с доступом к тому же каналу.</p>:null}
      {canManage?<div className="studio-actions"><button className="button secondary" disabled={pending||!data.configuration.ready||connection.status==='REVOKED'} onClick={()=>void perform(async()=>{await api(`${base}/social/${connection.id}/refresh`,'POST',{revision:connection.revision});setNotice('Права подключения проверены');})}>Проверить права</button><button className="button secondary" disabled={pending||!data.configuration.ready} onClick={()=>{setReplace(connection);setToken('');}}>Обновить токен</button>{connection.status!=='REVOKED'?<button className="text-button" disabled={pending} onClick={()=>setDisconnect(connection.id)}>Отключить канал</button>:null}</div>:null}
      {disconnect===connection.id?<div className="notice warning"><p>Отключение удалит сохранённый токен из CONTENTOS AI. Сам бот останется в Telegram-канале.</p><div className="studio-actions"><button className="button primary" disabled={pending} onClick={()=>void perform(async()=>{await api(`${base}/social/${connection.id}/disconnect`,'POST',{revision:connection.revision});setDisconnect(null);if(replace?.id===connection.id){setReplace(null);setToken('');}setNotice('Канал отключён');})}>Подтвердить отключение</button><button className="button secondary" disabled={pending} onClick={()=>setDisconnect(null)}>Отмена</button></div></div>:null}
    </article>)}</div>
  </section>;
}
