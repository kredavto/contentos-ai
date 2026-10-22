'use client';
import {useEffect,useState} from 'react';
import type {YouTubeService} from '@contentos/core';
import {api} from '../lib/api-client';
type Overview=Awaited<ReturnType<YouTubeService['overview']>>;
const labels={PENDING:'Проверяется',CONNECTED:'Подключено',LIMITED:'Недостаточно прав',ACTIVE:'Подключено',TOKEN_EXPIRED:'Нужно подключить заново',REVOKED:'Отключено',ERROR:'Ошибка проверки'};
export function YouTubeConnections({base,canManage}:{base:string;canManage:boolean}){
  const [data,setData]=useState<Overview|null>(null),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[disconnect,setDisconnect]=useState<string|null>(null);
  async function load(){setData(await api<Overview>(`${base}/youtube`));}
  useEffect(()=>{
    const result=new URLSearchParams(window.location.search).get('youtube');
    let active=true;api<Overview>(`${base}/youtube`).then(value=>{if(active){setData(value);if(result==='connected'&&value.connections.some(row=>row.status==='ACTIVE'))setNotice('Подключение YouTube подтверждено. Проверьте выбранный канал.');}}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить подключения YouTube');});
    if(result==='denied')setNotice('Доступ к YouTube не предоставлен. Подключение не создано.');
    return()=>{active=false;};
  },[base]);
  async function perform(action:()=>Promise<void>){setPending(true);setError('');setNotice('');try{await action();await load();}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось выполнить действие с YouTube');}finally{setPending(false);}}
  async function connect(connection?:Overview['connections'][number]){
    const result=await api<{authorizationUrl:string}>(`${base}/youtube`,'POST',connection?{connectionId:connection.id,revision:connection.revision}:{});
    const url=new URL(result.authorizationUrl);if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth')throw new Error('Не удалось открыть безопасную страницу подключения');
    window.location.assign(url.href);
  }
  return <section className="stack" aria-label="Подключения YouTube"><h3>YouTube</h3><p>Разрешите доступ через Google. Пароль и токены не нужно вводить в CONTENTOS AI. Подключение канала само по себе ничего не публикует.</p>
    {error?<p role="alert" className="notice error">{error}</p>:null}{notice?<p role="status" className="notice">{notice}</p>:null}
    {!data&&!error?<p role="status">Загружаем YouTube…</p>:null}
    {error?<button className="button secondary" disabled={pending} onClick={()=>void perform(load)}>Повторить загрузку YouTube</button>:null}
    {data&&!data.configuration.ready?<p className="notice warning">YouTube ещё не настроен. Администратору нужно подключить приложение Google и защищённое хранение доступа.</p>:null}
    {canManage?<button className="button primary" disabled={pending||!data?.configuration.ready} onClick={()=>void perform(()=>connect())}>Подключить YouTube через Google</button>:null}
    {data&&!data.connections.length?<p>Подключённых YouTube-каналов пока нет.</p>:null}
    <div className="plan-grid">{data?.connections.map(connection=><article key={connection.id} className="panel stack"><span className="badge">{labels[connection.status]}</span><h4>{connection.name}</h4>{connection.username?<p>{connection.username}</p>:null}<p className="muted">Доступность видео выбирается отдельно для каждой публикации.</p>
      {canManage?<div className="studio-actions"><button className="button secondary" disabled={pending||!data.configuration.ready||connection.status==='REVOKED'} onClick={()=>void perform(async()=>{await api(`${base}/youtube/${connection.id}/check`,'POST',{revision:connection.revision});setNotice('Доступ к YouTube проверен');})}>Проверить доступ YouTube</button><button className="button secondary" disabled={pending||!data.configuration.ready} onClick={()=>void perform(()=>connect(connection))}>Переподключить YouTube</button>{connection.status!=='REVOKED'?<button className="text-button" disabled={pending} onClick={()=>setDisconnect(connection.id)}>Отключить YouTube</button>:null}</div>:null}
      {disconnect===connection.id?<div className="notice warning"><p>Сохранённый доступ к этому каналу будет удалён из CONTENTOS AI, а ожидающие отправки отменены. Разрешение всему приложению можно отдельно отозвать в настройках Google.</p><div className="studio-actions"><button className="button secondary" disabled={pending} onClick={()=>void perform(async()=>{await api(`${base}/social/${connection.id}/disconnect`,'POST',{revision:connection.revision});setDisconnect(null);setNotice('YouTube отключён');})}>Подтвердить отключение YouTube</button><button className="text-button" disabled={pending} onClick={()=>setDisconnect(null)}>Отмена</button></div></div>:null}
    </article>)}</div>
  </section>;
}
