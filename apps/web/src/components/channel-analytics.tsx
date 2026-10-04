'use client';
import {useEffect,useRef,useState} from 'react';
import type {ChannelAnalyticsService} from '@contentos/core';
import {api} from '../lib/api-client';
type Overview=Awaited<ReturnType<ChannelAnalyticsService['overview']>>;
type History=Awaited<ReturnType<ChannelAnalyticsService['history']>>;
const labels={QUEUED:'В очереди',RUNNING:'Получаем данные',SUCCEEDED:'Данные получены',FAILED:'Не удалось получить данные',CANCELLED:'Сбор отменён'};
export function ChannelAnalytics({base,canManage}:{base:string;canManage:boolean}){
  const [data,setData]=useState<Overview|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false),[refresh,setRefresh]=useState(0),[historyId,setHistoryId]=useState(''),[history,setHistory]=useState<History|null>(null);
  const intents=useRef(new Map<string,string>()),historyRequest=useRef(0);
  useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;async function poll(){try{const result=await api<Overview>(`${base}/channel-analytics`);if(active)setData(result);}catch(failure){if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить показатели каналов');}finally{if(active)timer=setTimeout(()=>void poll(),5000);}}void poll();return()=>{active=false;clearTimeout(timer);historyRequest.current++;};},[base,refresh]);
  async function request(id:string){setPending(true);setError('');try{let key=intents.current.get(id);if(!key){key=crypto.randomUUID();intents.current.set(id,key);}await api(`${base}/channel-analytics`,'POST',{connectionId:id,idempotencyKey:key});intents.current.delete(id);setRefresh(value=>value+1);}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось запустить сбор');}finally{setPending(false);}}
  async function showHistory(id:string){const version=++historyRequest.current;setHistoryId(id);setHistory(null);setError('');try{const rows=await api<History>(`${base}/channel-analytics/${id}`);if(version===historyRequest.current)setHistory(rows);}catch(failure){if(version===historyRequest.current){setHistoryId('');setError(failure instanceof Error?failure.message:'Не удалось загрузить историю канала');}}}
  return <section className="stack" aria-label="Показатели каналов"><h2>Показатели каналов</h2><p className="muted">Число участников получаем из API площадки по запросу. Это показатель всего канала, а не охват поста. Сбор работает в фоне; повторный запрос доступен через минуту. История остаётся доступной после отключения канала.</p>
    {error?<p className="notice error" role="alert">{error}</p>:null}{!data&&!error?<p role="status">Загружаем каналы…</p>:null}
    {data&&!data.configuration.ready?<p className="notice warning">Автоматический сбор показателей каналов не настроен на сервере.</p>:null}
    {data&&!data.channels.length?<p className="panel empty">Подключите канал в разделе «Интеграции».</p>:null}
    {data?.channels.map(channel=>{const running=channel.job&&['QUEUED','RUNNING'].includes(channel.job.status);return <article className="panel stack" key={channel.id}><h3>{channel.name}</h3><p className="muted">{['ACTIVE','LIMITED'].includes(channel.status)?'Подключение доступно':'Подключение требует проверки в «Интеграциях»'}</p>
      {channel.latest?<><span className="badge">{channel.latest.source==='DEMO'?'ДЕМО: тестовые показатели':'Источник: API площадки'}</span><p>Участников: <strong>{channel.latest.memberCount.toLocaleString('ru')}</strong></p><p className="muted">Наблюдение: {new Date(channel.latest.observedAt).toLocaleString('ru')}. Это сохранённый снимок, а не значение в реальном времени.</p></>:<p>Участников: нет данных</p>}
      {channel.job?<p role={running?'status':undefined}>{labels[channel.job.status]}{channel.job.status==='FAILED'?' — проверьте подключение и повторите запрос позже.':''}</p>:null}
      {canManage?<button className="button primary" disabled={pending||!!running||!data.configuration.ready||channel.provider!==data.configuration.provider||!['ACTIVE','LIMITED'].includes(channel.status)||(!!channel.job&&Date.now()-new Date(channel.job.createdAt).getTime()<60000)} onClick={()=>void request(channel.id)}>Получить показатели канала</button>:null}
      <button className="button secondary" onClick={()=>void showHistory(channel.id)}>История показателей канала</button>
      {historyId===channel.id?<div className="stack"><h4>Последние 100 наблюдений канала</h4>{history===null?<p role="status">Загружаем историю канала…</p>:!history.length?<p>Наблюдений канала пока нет.</p>:history.map((item,index)=>{const previous=history[index+1],comparable=previous&&previous.source===item.source&&new Date(previous.observedAt).getTime()<new Date(item.observedAt).getTime();return <div key={item.id}><p>{new Date(item.observedAt).toLocaleString('ru')} · {item.memberCount.toLocaleString('ru')} участников · {item.source==='DEMO'?'ДЕМО':'API'}</p>{comparable?<p className="muted">Изменение с {new Date(previous.observedAt).toLocaleString('ru')}: {item.memberCount-previous.memberCount}. Это изменение канала между двумя наблюдениями, без привязки к публикации.</p>:null}</div>;})}</div>:null}
    </article>;})}
  </section>;
}
