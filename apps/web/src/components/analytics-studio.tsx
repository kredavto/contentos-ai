'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {AnalyticsService} from '@contentos/core';
import {metricLabels,type NormalizedMetrics} from '@contentos/types';
import {api} from '../lib/api-client';
type Overview=Awaited<ReturnType<AnalyticsService['overview']>>;
type History=Awaited<ReturnType<AnalyticsService['history']>>;
const keys=Object.keys(metricLabels) as (keyof NormalizedMetrics)[];
function Metrics({values}:{values:NormalizedMetrics|null}){return <dl className="analytics-metrics">{keys.map(key=><div key={key}><dt>{metricLabels[key]}</dt><dd>{values?.[key]===null||values?.[key]===undefined?'Нет данных':values[key].toLocaleString('ru')}</dd></div>)}</dl>;}
export function AnalyticsStudio({base,canManage}:{base:string;canManage:boolean}){
  const [rows,setRows]=useState<Overview|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false),[refresh,setRefresh]=useState(0);
  const [selected,setSelected]=useState(''),[history,setHistory]=useState<History|null>(null),[historyId,setHistoryId]=useState('');
  const intent=useRef<{payload:string;key:string}|null>(null),historyRequest=useRef(0);
  useEffect(()=>{let active=true;api<Overview>(`${base}/analytics`).then(data=>{if(active)setRows(data);}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить аналитику');});return()=>{active=false;historyRequest.current++;};},[base,refresh]);
  async function showHistory(id:string){const request=++historyRequest.current;setHistoryId(id);setHistory(null);setError('');try{const result=await api<History>(`${base}/analytics/${id}`);if(request===historyRequest.current)setHistory(result);}catch(failure){if(request===historyRequest.current){setHistoryId('');setError(failure instanceof Error?failure.message:'Не удалось загрузить историю');}}}
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=event.currentTarget,data=new FormData(form);setPending(true);setError('');setNotice('');
    try{
      const metrics=Object.fromEntries(keys.map(key=>[key,data.get(key)===''?null:Number(data.get(key))]));
      const input={publicationId:selected,observedAt:new Date(String(data.get('observedAt'))).toISOString(),sourceNote:String(data.get('sourceNote')),metrics},payload=JSON.stringify(input);
      if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};
      await api(`${base}/analytics`,'POST',{...input,idempotencyKey:intent.current.key});
      form.reset();setSelected('');intent.current=null;setNotice('Показатели сохранены. История наблюдений сохранена.');setHistoryId('');setHistory(null);setRefresh(value=>value+1);
    }catch(failure){setError(failure instanceof Error?failure.message:'Не удалось сохранить показатели');}finally{setPending(false);}
  }
  return <section className="stack"><h2>Аналитика публикаций</h2><p className="muted">Последние 100 публикаций. У каждой показаны значения из последнего по дате наблюдения; наблюдения не суммируются. Пустое поле означает отсутствие данных, а 0 — измеренный ноль.</p>
    <p className="notice warning">Автоматический сбор показателей пока не подключён. Telegram Bot API не предоставляет просмотры отдельных постов. Введите доступные показатели из статистики площадки; они будут отмечены как введённые вручную.</p>
    {error?<p role="alert" className="notice error">{error}</p>:null}{notice?<p role="status" className="notice success">{notice}</p>:null}
    {!rows&&!error?<p role="status">Загружаем аналитику…</p>:null}<button className="text-button" disabled={pending} onClick={()=>{setError('');setRefresh(value=>value+1);}}>Обновить аналитику</button>
    {rows&&!rows.length?<div className="panel empty">После подтверждённой отправки здесь появятся публикации.</div>:null}
    {canManage&&!!rows?.length?<form onSubmit={save} className="panel stack"><h3>Добавить наблюдение</h3><p className="muted">Запишите полный набор известных показателей на указанное время. Для исправления добавьте наблюдение с той же датой: предыдущая запись останется в истории. Не переносите общие показатели канала на отдельный пост.</p><fieldset disabled={pending} className="stack"><legend className="sr-only">Показатели публикации</legend>
      <label>Публикация для аналитики<select aria-label="Публикация для аналитики" required value={selected} onChange={event=>setSelected(event.target.value)}><option value="">Выберите публикацию</option>{rows.map(row=><option key={row.id} value={row.id}>{row.title}{row.provider.startsWith('mock-')?' · ДЕМО':''}</option>)}</select></label>
      <label>Дата наблюдения<input name="observedAt" type="datetime-local" step="1" required/></label><p className="muted">Часовой пояс: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Дата должна быть после публикации и не в будущем.</p>
      <label>Источник показателей<input name="sourceNote" minLength={3} maxLength={500} required placeholder="Например: статистика поста в Telegram"/></label>
      <div className="analytics-inputs">{keys.map(key=><label key={key}>{metricLabels[key]}<input name={key} type="number" min={key==='followers_delta'?-1_000_000_000_000:0} max={key==='completion_rate'?1:1_000_000_000_000} step={['watch_time','average_watch_time','completion_rate'].includes(key)?'any':1} placeholder="Нет данных"/></label>)}</div>
      <button className="button primary" disabled={!selected}>Сохранить показатели</button></fieldset></form>:null}
    {rows?.map(row=><article key={row.id} className="panel stack"><h3>{row.title}</h3><p className="muted">Опубликовано: {new Date(row.publishedAt).toLocaleString('ru')}{row.provider.startsWith('mock-')?' · ДЕМО: отправка была имитирована':''}</p>
      {row.latest?<><span className="badge">Введено вручную</span><p>Наблюдение: {new Date(row.latest.observedAt).toLocaleString('ru')} · Источник: {row.latest.sourceNote}</p></>:<p className="muted">Наблюдений пока нет.</p>}
      <Metrics values={row.latest?.metrics??null}/><button className="button secondary" onClick={()=>void showHistory(row.id)}>История показателей</button>
      {historyId===row.id?<div className="stack"><h4>Последние 100 наблюдений</h4>{history===null?<p role="status">Загружаем историю…</p>:!history.length?<p>Наблюдений пока нет.</p>:history.map(item=><details key={item.id}><summary>{new Date(item.observedAt).toLocaleString('ru')} · Введено вручную</summary><p>Источник: {item.sourceNote}</p><p className="muted">Сохранено: {new Date(item.recordedAt).toLocaleString('ru')}</p><Metrics values={item.metrics}/></details>)}</div>:null}
    </article>)}
  </section>;
}
