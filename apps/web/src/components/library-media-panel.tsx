'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {LibraryMediaService} from '@contentos/core';
import {api} from '../lib/api-client';
import {LibraryMediaUpload} from './library-media-upload';
import {libraryResumeSchema,type LibraryResume} from '@contentos/types';

type Overview=Awaited<ReturnType<LibraryMediaService['overview']>>;
type Asset=Overview['assets'][number];
const labels:Record<Asset['status'],string>={UPLOADING:'Ожидает загрузки',QUEUED:'В очереди',RUNNING:'Обрабатывается',READY:'Готово',FAILED:'Ошибка обработки',DELETE_PENDING:'Удаляется',DELETED:'Удалено'};
const failureMessages:Record<string,string>={INVALID_MEDIA:'Файл не прошёл проверку формата, размера или длительности.',NOT_AUTHORIZED:'Обработка остановлена: права автора изменились.',CONFIGURATION_REQUIRED:'Обработка недоступна до настройки сервиса администратором.',PROVIDER_UNAVAILABLE:'Не удалось завершить обработку после повторных попыток.'};

export function LibraryMediaPanel({base,canWrite}:{base:string;canWrite:boolean}){
  const [data,setData]=useState<Overview|null>(null);
  const [loadError,setLoadError]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [pending,setPending]=useState(false);
  const [recovery,setRecovery]=useState<LibraryResume|null>(null);
  const [preview,setPreview]=useState<{id:string;url:string;expiresAt:number}|null>(null);
  const version=useRef(0),busy=useRef(false),mounted=useRef(false);
  const refresh=useCallback(async()=>{
    const requestVersion=++version.current;
    try{
      const next=await api<Overview>(`${base}/library-media`);
      if(!mounted.current||requestVersion!==version.current)return;
      setData(next);setLoadError('');
      setPreview(current=>current&&next.assets.some(asset=>asset.id===current.id&&asset.status==='READY')?current:null);
    }catch(failure){
      if(!mounted.current||requestVersion!==version.current)return;
      setData(null);setPreview(null);setLoadError(failure instanceof Error?failure.message:'Не удалось обновить список файлов');
    }
  },[base]);
  useEffect(()=>{
    mounted.current=true;
    let active=true,timer:ReturnType<typeof setTimeout>;
    async function poll(){await refresh();if(active)timer=setTimeout(()=>void poll(),5000);}
    void poll();
    return()=>{active=false;mounted.current=false;++version.current;clearTimeout(timer);};
  },[refresh]);
  useEffect(()=>{
    if(!preview)return;
    const timer=setTimeout(()=>{setPreview(null);setNotice('Срок ссылки истёк. Откройте файл снова для продолжения просмотра.');},Math.max(0,preview.expiresAt-Date.now()));
    return()=>clearTimeout(timer);
  },[preview]);
  async function perform(action:()=>Promise<void>){
    if(busy.current)return;
    busy.current=true;setPending(true);setError('');setNotice('');
    try{await action();}catch(failure){if(mounted.current)setError(failure instanceof Error?failure.message:'Не удалось выполнить действие');}
    finally{busy.current=false;if(mounted.current)setPending(false);}
  }
  async function open(asset:Asset){
    const link=await api<{url:string;expiresInSeconds:number}>(`${base}/library-media/${asset.id}/download`);
    if(mounted.current)setPreview({id:asset.id,url:link.url,expiresAt:Date.now()+link.expiresInSeconds*1000});
  }
  async function remove(asset:Asset){
    await api(`${base}/library-media/${asset.id}/delete`,'POST');
    if(!mounted.current)return;
    ++version.current;
    if(recovery?.id===asset.id)setRecovery(null);
    setPreview(current=>current?.id===asset.id?null:current);
    setData(current=>current?{...current,assets:current.assets.map(item=>item.id===asset.id?{...item,status:'DELETE_PENDING'}:item)}:current);
    setNotice('Удаление запланировано. Файл больше недоступен для открытия.');
    await refresh();
  }
  return <section className="media-library stack" aria-label="Аудио и видео">
    <div className="section-heading"><div><h2>Аудио и видео</h2><p className="muted">Статусы обработки и просмотр файлов бренда.</p></div></div>
    {canWrite?<LibraryMediaUpload key={recovery?.id??'new'} base={base} enabled={data?.configuration.ready??false} onChanged={refresh} recovery={recovery} onNewUpload={()=>setRecovery(null)}/>:null}
    {data&&!data.configuration.ready?<p className="notice warning">Новая обработка недоступна до настройки сервиса. Сохранённые файлы можно открыть или удалить при наличии доступа.</p>:null}
    {loadError?<p className="notice error" role="alert">{loadError} Список обновится автоматически.</p>:null}
    {error?<p className="notice error" role="alert">{error}</p>:null}
    {notice?<p className="notice success" role="status">{notice}</p>:null}
    {!data&&!loadError?<p role="status">Загружаем аудио и видео…</p>:null}
    {data&&!data.assets.length?<div className="panel empty">Аудио и видео пока нет.</div>:null}
    <div className="plan-grid">{data?.assets.map(asset=><article className="panel stack library-media-card" key={asset.id} aria-label={asset.name}>
      <span className="badge">{labels[asset.status]}</span><h3>{asset.name}</h3>
      <small>{asset.sourceMime==='video/mp4'?'Видео':'Аудио'}{asset.durationMs!==null?` · ${(asset.durationMs/1000).toFixed(1)} с`:''}{asset.bytes!==null?` · ${(asset.bytes/1024/1024).toFixed(1)} МБ`:''}{asset.width!==null&&asset.height!==null?` · ${asset.width} × ${asset.height}`:''}{asset.hasAudio===false?' · Без звука':''}</small>
      {asset.status==='FAILED'?<p className="notice warning">{failureMessages[asset.errorCode??'']??'Не удалось подготовить файл. Удалите его и добавьте заново.'}</p>:null}
      {asset.status==='DELETE_PENDING'?<p className="muted">Файл закрыт для просмотра. Очистка хранилища выполняется автоматически.</p>:null}
      {preview?.id===asset.id&&asset.status==='READY'?<div className="stack">
        {asset.mimeType==='video/mp4'?<video className="media-preview" aria-label={`Просмотр: ${asset.name}`} src={preview.url} controls playsInline preload="metadata" onError={()=>{setPreview(null);setError('Не удалось воспроизвести файл. Откройте его снова.');}}/>:<audio aria-label={`Прослушивание: ${asset.name}`} src={preview.url} controls preload="metadata" onError={()=>{setPreview(null);setError('Не удалось воспроизвести файл. Откройте его снова.');}}/>}
        <small className="muted">Доступ к просмотру действует одну минуту.</small>
        <button className="text-button" onClick={()=>setPreview(null)}>Закрыть просмотр</button>
      </div>:null}
      <div className="studio-actions">
        {canWrite&&asset.canResume?<button className="button secondary" disabled={pending||!data.configuration.ready} onClick={()=>void perform(async()=>{
          const result=libraryResumeSchema.parse(await api(`${base}/library-media/${asset.id}/upload-intent`));
          if(mounted.current)setRecovery(result);
        })}>Продолжить загрузку файла</button>:null}
        {asset.status==='READY'?<button className="button secondary" disabled={pending} onClick={()=>void perform(()=>open(asset))}>{asset.sourceMime==='video/mp4'?'Открыть видео':'Прослушать аудио'}</button>:null}
        {canWrite&&asset.status!=='DELETE_PENDING'&&asset.status!=='DELETED'?<button className="text-button" disabled={pending} onClick={()=>void perform(()=>remove(asset))}>Удалить файл</button>:null}
      </div>
    </article>)}</div>
  </section>;
}
