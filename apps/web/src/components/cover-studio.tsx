'use client';
import {useEffect,useRef,useState} from 'react';
import type {CoverService,VideoService} from '@contentos/core';
import {api} from '../lib/api-client';
import {CoverControls,initialCoverDesign} from './cover-controls';
type Overview=Awaited<ReturnType<CoverService['overview']>>;
const labels={QUEUED:'В очереди',RUNNING:'Создаётся',READY:'Готова',FAILED:'Ошибка — резерв возвращён',CANCELLED:'Отменена',DELETED:'Удалена'};
export function CoverStudio({base,canWrite,onSelected}:{base:string;canWrite:boolean;onSelected:()=>void}){
  const [data,setData]=useState<Overview|null>(null),[design,setDesign]=useState(initialCoverDesign),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false);
  const [source,setSource]=useState<Awaited<ReturnType<VideoService['download']>>|null>(null),[preview,setPreview]=useState<{version:number;url:string}|null>(null);
  const video=useRef<HTMLVideoElement>(null),intent=useRef<{payload:string;key:string}|null>(null),initialized=useRef(false);
  useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;async function poll(){try{const result=await api<Overview>(`${base}/covers`);if(active){setData(result);if(!initialized.current){setDesign(result.versions.find(item=>item.version===result.selectedVersion)?.design??result.initialDesign??initialCoverDesign);initialized.current=true;}}}catch(failure){if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить обложки');}finally{if(active)timer=setTimeout(()=>void poll(),3000);}}void poll();return()=>{active=false;clearTimeout(timer);};},[base]);
  async function perform(action:()=>Promise<void>){setPending(true);setError('');setNotice('');try{await action();setData(await api(`${base}/covers`));}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось выполнить действие');}finally{setPending(false);}}
  const running=data?.versions.some(item=>['QUEUED','RUNNING'].includes(item.status));
  return <section className="panel stack" aria-label="Редактор обложек"><h3>Редактор обложек</h3>
    <p className="muted">Новый рендер аватара не нужен. Создайте и просмотрите вариант, затем выберите его для видео. Максимум 50 версий. Замена недоступна при запланированной или незавершённой публикации — отмените запланированную публикацию в разделе «Публикации», а при неизвестном исходе дождитесь проверки.</p>
    <p className="muted">Обложка используется в предпросмотре и доступна для скачивания. Текущий адаптер публикации не отправляет её как миниатюру площадки.</p>
    {error?<p role="alert" className="notice error">{error}</p>:null}{notice?<p role="status" className="notice success">{notice}</p>:null}
    {!data?<p role="status">Загружаем версии…</p>:<p>Выбрана версия {data.selectedVersion}. Версия 0 — исходная обложка.</p>}
    <button className="button secondary" disabled={pending} onClick={()=>void perform(async()=>setSource(await api(`${base}/download`)))}>Открыть видео для выбора кадра</button>
    {source?<><video ref={video} className="video-preview" controls preload="metadata" src={source.videoUrl} aria-label="Видео для выбора кадра"/>{canWrite?<button className="button secondary" onClick={()=>{const element=video.current;if(element&&Number.isFinite(element.duration)&&element.duration>0){setDesign({...design,frameSeconds:Math.round(Math.min(180,element.currentTime)*1000)/1000,framePercent:Math.min(95,Math.max(0,Math.round(element.currentTime/element.duration*100)))});setNotice('Положение кадра перенесено в настройки обложки');}}}>Использовать этот кадр</button>:null}</>:null}
    {canWrite?<form className="stack" onSubmit={event=>{event.preventDefault();void perform(async()=>{const payload=JSON.stringify(design);if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};await api(`${base}/covers`,'POST',{design,idempotencyKey:intent.current.key});intent.current=null;setNotice('Обложка добавлена в очередь. Текущая версия пока не меняется.');});}}>
      <CoverControls value={design} onChange={setDesign} existing/>
      <p>Резерв: {data?.cost??'—'} AI-кредитов. Списание после успешного рендера; при окончательной ошибке резерв возвращается.</p>
      <button className="button primary" disabled={pending||!data||running||data.versions.length>=50}>Создать версию обложки</button>
    </form>:null}
    <div className="stack">{[{version:0,status:'READY' as const,design:data?.initialDesign??null},...(data?.versions??[])].map(item=><div className="panel stack" key={item.version}><strong>Обложка v{item.version}{data?.selectedVersion===item.version?' · выбрана':''}</strong>{item.design?<span>{item.design.headline}</span>:null}<span>{labels[item.status]}</span><div className="studio-actions">
      {item.status==='READY'?<><button className="button secondary" disabled={pending} onClick={()=>void perform(async()=>setPreview({version:item.version,...await api<{url:string}>(`${base}/covers/${item.version}`)}))}>Посмотреть v{item.version}</button>{canWrite?<button className="button secondary" disabled={pending||!data||data.selectedVersion===item.version} onClick={()=>void perform(async()=>{await api(`${base}/covers`,'PUT',{version:item.version,revision:data!.revision});setNotice('Обложка выбрана. Одобрите видео заново перед публикацией.');onSelected();})}>Выбрать v{item.version}</button>:null}</>:null}
      {canWrite&&item.design?<button className="text-button" disabled={pending} onClick={()=>{setDesign(item.design!);setNotice(`Настройки v${item.version} загружены для новой версии`);}}>Изменить на основе v{item.version}</button>:null}
    </div></div>)}</div>
    {preview?<div className="stack"><img className="media-preview" src={preview.url} alt={`Обложка версии ${preview.version}`} referrerPolicy="no-referrer"/><a className="button secondary" href={preview.url} target="_blank" rel="noreferrer">Открыть файл v{preview.version}</a><small>Ссылка действует две минуты. Для обновления нажмите «Посмотреть» ещё раз.</small></div>:null}
  </section>;
}
