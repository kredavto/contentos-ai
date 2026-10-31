'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { FunnelService } from '@contentos/core';
import { api } from '../lib/api-client';
type Targets=Awaited<ReturnType<FunnelService['list']>>;
type Choices=Awaited<ReturnType<FunnelService['choices']>>;
type Reports=Awaited<ReturnType<FunnelService['measurements']>>;
const destinations={URL:'URL',WEBSITE:'Сайт',TELEGRAM:'Telegram',LEAD_FORM:'Форма заявки',MESSENGER:'Мессенджер'};
function SourceChoice({base,kind,value,onChange,disabled}:{base:string;kind:'CONTENT'|'LINK';value:string;onChange:(value:string)=>void;disabled:boolean}){
  const id=useId(),[search,setSearch]=useState(''),[before,setBefore]=useState(''),[data,setData]=useState<Choices|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;setData(null);setError('');api<Choices>(`${base}/funnels/choices?kind=${kind}&search=${encodeURIComponent(search)}${before?`&before=${before}`:''}`).then(result=>{if(active)setData(result);}).catch(failure=>{if(active)setError(failure.message);});return()=>{active=false;};},[base,kind,search,before]);
  const name=kind==='CONTENT'?'Материал':'UTM-ссылка';
  return <div className="stack"><label htmlFor={`${id}-search`}>Поиск: {name}</label><input id={`${id}-search`} value={search} maxLength={100} disabled={disabled} onChange={event=>{setSearch(event.target.value);setBefore('');onChange('');}}/>
    <label htmlFor={id}>{name}</label><select id={id} required disabled={disabled||!data} value={value} onChange={event=>onChange(event.target.value)}><option value="">{data?'Выберите из списка':'Загрузка…'}</option>{data?.rows.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</select>
    {error?<p role="alert" className="notice error">{error}</p>:null}{data&&!data.rows.length?<p className="muted">Ничего не найдено. Создайте {kind==='CONTENT'?'материал в календаре или сценарий':'активную UTM-ссылку'} в этом бренде.</p>:null}
    <div className="studio-actions">{before?<button type="button" className="text-button" disabled={disabled} onClick={()=>{setBefore('');onChange('');}}>Сначала: {name}</button>:null}{data?.nextCursor?<button type="button" className="text-button" disabled={disabled} onClick={()=>{setBefore(data.nextCursor!);onChange('');}}>Следующие 50: {name}</button>:null}</div>
  </div>;
}
function ReportPanel({base,target,canManage}:{base:string;target:Targets['rows'][number];canManage:boolean}){
  const [data,setData]=useState<Reports|null>(null),[before,setBefore]=useState(''),[reload,setReload]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false);
  const empty=()=>({from:'',to:'',clicks:'',leads:'',source:'',expectedVersion:0});
  const [draft,setDraft]=useState(empty);const intent=useRef<{payload:string;key:string}|null>(null);
  const endpoint=`${base}/funnels/${target.id}/measurements`;
  useEffect(()=>{let active=true;setData(null);setError('');api<Reports>(`${endpoint}${before?`?before=${before}`:''}`).then(result=>{if(active)setData(result);}).catch(failure=>{if(active)setError(failure.message);});return()=>{active=false;};},[endpoint,before,reload]);
  async function save(){setPending(true);setError('');setNotice('');try{
    const input={from:new Date(`${draft.from}Z`).toISOString(),to:new Date(`${draft.to}Z`).toISOString(),clicks:draft.clicks===''?null:Number(draft.clicks),leads:draft.leads===''?null:Number(draft.leads),source:draft.source,expectedVersion:draft.expectedVersion};
    const payload=JSON.stringify(input);if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};
    await api(endpoint,'POST',{...input,idempotencyKey:intent.current.key});intent.current=null;setDraft(empty());setBefore('');setReload(value=>value+1);setNotice('Ручной отчёт сохранён.');
  }catch(failure){setError(failure instanceof Error?failure.message:'Не удалось сохранить отчёт');}finally{setPending(false);}}
  function correct(row:Reports['rows'][number]){setDraft({from:new Date(row.from).toISOString().slice(0,-1),to:new Date(row.to).toISOString().slice(0,-1),clicks:row.clicks===null?'':String(row.clicks),leads:row.leads===null?'':String(row.leads),source:row.source,expectedVersion:row.version});setNotice('Редактируется новая версия выбранного периода. Предыдущая сохранится в истории.');}
  return <section className="panel brand-profile-editor"><h3>Отчёты: {target.cta}</h3><p className="muted">Только ручные данные. Указывайте источник, например название отчёта веб-аналитики или CRM, без персональных данных и секретов. Периоды могут пересекаться; значения не суммируются. Пустое поле означает «нет данных».</p>
    {error?<p className="notice error" role="alert">{error}</p>:null}{notice?<p role="status" className="saved-message">{notice}</p>:null}
    {canManage?<form onSubmit={event=>{event.preventDefault();void save();}}><fieldset disabled={pending}><div className="studio-form">
      <label>Начало периода (UTC)<input type="datetime-local" step="0.001" required value={draft.from} disabled={draft.expectedVersion>0} onChange={event=>setDraft(value=>({...value,from:event.target.value}))}/></label>
      <label>Конец периода, не включая (UTC)<input type="datetime-local" step="0.001" required value={draft.to} disabled={draft.expectedVersion>0} onChange={event=>setDraft(value=>({...value,to:event.target.value}))}/></label>
      <label>Клики<input type="number" min={0} max={1000000000} step={1} value={draft.clicks} onChange={event=>setDraft(value=>({...value,clicks:event.target.value}))}/></label>
      <label>Заявки<input type="number" min={0} max={1000000000} step={1} value={draft.leads} onChange={event=>setDraft(value=>({...value,leads:event.target.value}))}/></label>
      <label>Источник данных<input required minLength={3} maxLength={160} value={draft.source} onChange={event=>setDraft(value=>({...value,source:event.target.value}))}/></label>
    </div></fieldset><div className="studio-actions"><button className="button primary" disabled={pending||(!draft.clicks&&!draft.leads)}>Сохранить ручной отчёт</button><button type="button" className="button secondary" disabled={pending} onClick={()=>{setDraft(empty());intent.current=null;}}>Новый период</button></div></form>:<p>Отчёты вносят подтверждённые владельцы, администраторы и менеджеры.</p>}
    <button className="text-button" disabled={pending} onClick={()=>setReload(value=>value+1)}>Обновить отчёты</button>
    {!data&&!error?<p>Загрузка отчётов…</p>:data&&!data.rows.length?<p>Отчётов пока нет. Клики и заявки неизвестны.</p>:null}
    {data?.rows.map(row=><article key={row.id}><h4>Версия {row.version} · {row.version===row.currentVersion?'актуальная':'заменена'}</h4><p>{new Date(row.from).toISOString()} — {new Date(row.to).toISOString()} (UTC)</p><p>Клики: {row.clicks??'нет данных'} · Заявки: {row.leads??'нет данных'}</p><p>Источник: {row.source} · введено вручную</p>{canManage&&row.version===row.currentVersion?<button className="text-button" disabled={pending} onClick={()=>correct(row)}>Исправить отчёт</button>:null}</article>)}
    <div className="studio-actions">{before?<button className="text-button" onClick={()=>setBefore('')}>В начало истории</button>:null}{data?.nextCursor?<button className="text-button" onClick={()=>setBefore(data.nextCursor!)}>Следующие 50 отчётов</button>:null}</div>
  </section>;
}
export function FunnelStudio({base,canWrite,canManage}:{base:string;canWrite:boolean;canManage:boolean}){
  const [data,setData]=useState<Targets|null>(null),[before,setBefore]=useState(''),[reload,setReload]=useState(0),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false),[selected,setSelected]=useState<Targets['rows'][number]|null>(null);
  const empty={contentItemId:'',utmLinkId:'',cta:'',destinationType:'WEBSITE' as keyof typeof destinations};const [draft,setDraft]=useState(empty);const destinationId=useId();const intent=useRef<{payload:string;key:string}|null>(null);
  useEffect(()=>{let active=true;setData(null);setError('');api<Targets>(`${base}/funnels${before?`?before=${before}`:''}`).then(result=>{if(active)setData(result);}).catch(failure=>{if(active)setError(failure.message);});return()=>{active=false;};},[base,before,reload]);
  async function save(){setPending(true);setError('');setNotice('');const payload=JSON.stringify(draft);if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};try{await api(`${base}/funnels`,'POST',{...draft,idempotencyKey:intent.current.key});intent.current=null;setDraft(empty);setBefore('');setReload(value=>value+1);setNotice('Связь материала и CTA сохранена.');}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось сохранить воронку');}finally{setPending(false);}}
  return <section className="stack funnel-studio"><h2>Воронки</h2><p className="muted">Свяжите материал с CTA и UTM-ссылкой. Это не публикует ссылку и не подключает сбор кликов или заявок. Фактические результаты можно занести вручную из вашей аналитики.</p>
    {error?<p className="notice error" role="alert">{error}</p>:null}{notice?<p role="status" className="saved-message">{notice}</p>:null}
    {canWrite?<form className="panel brand-profile-editor" onSubmit={event=>{event.preventDefault();void save();}}><h3>Новая воронка</h3><div className="studio-form"><SourceChoice base={base} kind="CONTENT" value={draft.contentItemId} disabled={pending} onChange={value=>setDraft(current=>({...current,contentItemId:value}))}/><SourceChoice base={base} kind="LINK" value={draft.utmLinkId} disabled={pending} onChange={value=>setDraft(current=>({...current,utmLinkId:value}))}/></div>
      <label>Призыв к действию<input required maxLength={300} disabled={pending} value={draft.cta} onChange={event=>setDraft(value=>({...value,cta:event.target.value}))}/></label><label htmlFor={destinationId}>Тип назначения</label><select id={destinationId} disabled={pending} value={draft.destinationType} onChange={event=>setDraft(value=>({...value,destinationType:event.target.value as keyof typeof destinations}))}>{Object.entries(destinations).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><button className="button primary" disabled={pending||!draft.contentItemId||!draft.utmLinkId||!draft.cta.trim()}>Создать воронку</button></form>:null}
    <button className="text-button" disabled={pending} onClick={()=>{setBefore('');setReload(value=>value+1);}}>Обновить воронки</button>
    {!data&&!error?<p>Загрузка воронок…</p>:data&&!data.rows.length?<p>Воронок пока нет.</p>:null}
    {data?.rows.map(row=><article className="panel brand-profile-editor" key={row.id}><h3>{row.title}</h3><p>CTA: {row.cta} · {destinations[row.destinationType as keyof typeof destinations]}</p>{row.linkArchivedAt?<p className="notice warning">UTM-ссылка в архиве. Сохранённый адрес остаётся прежним.</p>:null}<label htmlFor={`funnel-${row.id}`}>Адрес CTA: {row.cta}</label><textarea id={`funnel-${row.id}`} readOnly rows={3} value={row.taggedUrl}/><button className="button secondary" onClick={()=>setSelected(row)}>Отчёты: {row.cta}</button></article>)}
    <div className="studio-actions">{before?<button className="text-button" onClick={()=>setBefore('')}>В начало воронок</button>:null}{data?.nextCursor?<button className="text-button" onClick={()=>setBefore(data.nextCursor!)}>Следующие 50 воронок</button>:null}</div>
    {selected?<ReportPanel key={selected.id} base={base} target={selected} canManage={canManage}/>:null}
  </section>;
}
