'use client';
import { useEffect, useRef, useState } from 'react';
import type { MediaService } from '@contentos/core';
import { maxPhotoUploadBytes, photoMimeTypes } from '@contentos/types';
import { api } from '../lib/api-client';
type Overview = Awaited<ReturnType<MediaService['overview']>>;
const states = {UPLOADING:'Загружается',READY:'Готово',DELETE_PENDING:'Удаляется',DELETED:'Удалено'};
export function MediaLibrary({base,canWrite}:{base:string;canWrite:boolean}) {
  const [data,setData] = useState<Overview|null>(null);
  const [file,setFile] = useState<File|null>(null);
  const [error,setError] = useState(''); const [notice,setNotice] = useState(''); const [pending,setPending] = useState(false);
  const [preview,setPreview] = useState<{id:string;url:string;expiresAt:number}|null>(null);
  const intent = useRef<string|null>(null); const fileInput = useRef<HTMLInputElement>(null);
  useEffect(()=>{
    let active = true; let timer:ReturnType<typeof setTimeout>;
    async function poll(){try{const next=await api<Overview>(`${base}/media`);if(active){setData(next);timer=setTimeout(()=>void poll(),5000);}}catch(failure){if(active){setError(failure instanceof Error?failure.message:'Не удалось загрузить медиатеку');timer=setTimeout(()=>void poll(),10000);}}}
    void poll(); return()=>{active=false;clearTimeout(timer);};
  },[base]);
  async function perform(action:()=>Promise<void>){setPending(true);setError('');setNotice('');try{await action();setData(await api<Overview>(`${base}/media`));}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось выполнить действие');}finally{setPending(false);}}
  async function upload(){
    if(!file)return;
    if(file.size>maxPhotoUploadBytes||!photoMimeTypes.some(type=>type===file.type))throw new Error('Выберите JPEG, PNG или WebP размером до 3 МБ.');
    intent.current ??= crypto.randomUUID();
    const response=await fetch(`/api/${base}/media`,{method:'POST',headers:{'Content-Type':file.type,'X-File-Name':encodeURIComponent(file.name),'Idempotency-Key':intent.current},body:file,credentials:'same-origin'});
    const result=await response.json() as {error?:{message?:string}};
    if(!response.ok)throw new Error(result.error?.message??'Не удалось загрузить файл');
    intent.current=null;setFile(null);if(fileInput.current)fileInput.current.value='';setNotice('Фотография сохранена');
  }
  return <section className="media-library">
    <div className="section-heading"><div><h2>Медиатека бренда</h2><p className="muted">Фотографии для аватаров и контента. JPEG, PNG или WebP до 3 МБ.</p></div></div>
    {error?<p className="notice error" role="alert">{error}</p>:null}
    {notice?<p className="notice success" role="status">{notice}</p>:null}
    {!data?<p role="status">Загружаем медиатеку…</p>:null}
    {data&&!data.configuration.ready?<p className="notice warning">Хранилище ещё не подключено. Загрузка станет доступна после настройки администратором.</p>:null}
    {canWrite?<form className="panel stack" onSubmit={event=>{event.preventDefault();void perform(upload);}}>
      <label htmlFor="media-photo">Фотография</label><input ref={fileInput} id="media-photo" type="file" accept={photoMimeTypes.join(',')} disabled={pending||!data?.configuration.ready} onChange={event=>{setFile(event.target.files?.[0]??null);intent.current=null;setNotice('');}}/>
      <p className="muted">Загружайте только материалы, на использование которых у вас есть права. Перед созданием аватара потребуется отдельное согласие.</p>
      <button className="button primary" disabled={pending||!file||!data?.configuration.ready}>{pending?'Сохраняем…':'Загрузить фотографию'}</button>
    </form>:null}
    {data&&!data.assets.length?<div className="panel empty">Здесь появятся фотографии вашего бренда.</div>:null}
    <div className="plan-grid">{data?.assets.map(asset=><article className="panel stack" key={asset.id}>
      <span className="badge">{states[asset.status]}</span><h3>{asset.name}</h3><small>{asset.width} × {asset.height} · {Math.round(asset.bytes/1024)} КБ</small>
      {preview?.id===asset.id&&asset.status==='READY'?<><img className="media-preview" src={preview.url} alt={`Предпросмотр: ${asset.name}`} referrerPolicy="no-referrer" onError={()=>setPreview(null)}/><small className="muted">Ссылка действует одну минуту. Для повторного просмотра откройте файл снова.</small></>:null}
      {asset.errorCode?<p className="notice warning">{asset.status==='DELETE_PENDING'?'Хранилище недоступно. Удаление повторится автоматически.':'Загрузка прервалась. Повторите загрузку тем же запросом или удалите незавершённый файл.'}</p>:null}
      <div className="studio-actions">
        {asset.status==='READY'?<button className="button secondary" disabled={pending||!data.configuration.ready} onClick={()=>void perform(async()=>{const link=await api<{url:string;expiresInSeconds:number}>(`${base}/media/${asset.id}/download`);setPreview({id:asset.id,url:link.url,expiresAt:Date.now()+link.expiresInSeconds*1000});})}>Открыть фотографию</button>:null}
        {canWrite&&asset.status!=='DELETE_PENDING'?<button className="text-button" disabled={pending} onClick={()=>void perform(async()=>{await api(`${base}/media/${asset.id}/delete`,'POST');if(preview?.id===asset.id)setPreview(null);setNotice('Удаление запланировано');})}>Удалить фотографию</button>:null}
      </div>
    </article>)}</div>
  </section>;
}
