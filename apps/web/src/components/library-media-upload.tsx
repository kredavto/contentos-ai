'use client';
import {useEffect,useRef,useState} from 'react';
import {libraryUploadSchema,maxBrowserMediaBytes,maxMediaSourceBytes,mediaSourceMimeSchema,type MediaSourceMime,type LibraryResume} from '@contentos/types';
import {api} from '../lib/api-client';
import {sendLibrarySource} from '../lib/library-upload';

export function LibraryMediaUpload({base,enabled,onChanged,recovery,onNewUpload}:{base:string;enabled:boolean;onChanged:()=>Promise<void>;recovery:LibraryResume|null;onNewUpload:()=>void}){
  const [file,setFile]=useState<File|null>(null),[name,setName]=useState(recovery?.input.name??'');
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[stage,setStage]=useState('');
  const [progress,setProgress]=useState<number|null>(null);
  const input=useRef<HTMLInputElement>(null),intent=useRef<string|null>(recovery?.input.idempotencyKey??null),active=useRef<AbortController|null>(null);
  useEffect(()=>()=>{active.current?.abort();},[]);
  useEffect(()=>{if(recovery)input.current?.focus();},[recovery]);
  async function upload(){
    if(!file||active.current)return;
    const controller=new AbortController();active.current=controller;
    setPending(true);setError('');setNotice('');setProgress(null);
    try{
      // Some browsers label WAV as audio/x-wav or omit MIME; the worker still validates actual bytes.
      const inferred:Record<string,MediaSourceMime>={mp4:'video/mp4',mp3:'audio/mpeg',wav:'audio/wav'};
      const mime=mediaSourceMimeSchema.safeParse(file.type);
      const mimeType=mime.success?mime.data:(!file.type||file.type==='audio/x-wav')?inferred[file.name.split('.').at(-1)?.toLowerCase()??'']:undefined;
      if(!mimeType||file.size<12||file.size>maxMediaSourceBytes)throw new Error('Выберите MP4, MP3 или WAV размером до 64 МБ.');
      setStage('Проверяем файл…');
      const sourceBytes=await file.arrayBuffer();
      const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');
      const hash=hex(await crypto.subtle.digest('SHA-256',sourceBytes));
      if(controller.signal.aborted)return;
      let chunkHashes:string[]|undefined;
      if(file.size>maxBrowserMediaBytes||recovery?.input.chunkHashes){
        chunkHashes=[];
        for(let start=0;start<file.size;start+=maxBrowserMediaBytes){
          chunkHashes.push(hex(await crypto.subtle.digest('SHA-256',sourceBytes.slice(start,start+maxBrowserMediaBytes))));
          if(controller.signal.aborted)return;
        }
      }
      intent.current??=crypto.randomUUID();
      const parsed=libraryUploadSchema.safeParse({name,source:{mimeType,bytes:file.size,sha256:hash},idempotencyKey:intent.current,...(chunkHashes?{chunkHashes}:{})});
      if(!parsed.success)throw new Error('Укажите название от 1 до 160 символов без управляющих знаков.');
      if(recovery){
        if(Date.parse(recovery.expiresAt)<=Date.now())throw new Error('Срок загрузки истёк. Удалите незавершённую запись и начните новую загрузку.');
        if(parsed.data.source.sha256!==recovery.input.source.sha256||parsed.data.source.bytes!==recovery.input.source.bytes||parsed.data.source.mimeType!==recovery.input.source.mimeType)throw new Error('Выбран другой файл. Для продолжения выберите исходный файл с тем же содержимым.');
      }
      setStage('Подготавливаем загрузку…');
      const result=await api<{id:string;status:string;uploadedChunks:number[]}>(`${base}/library-media/upload-intents`,'POST',parsed.data);
      if(controller.signal.aborted)return;
      let status=result.status;
      if(status==='UPLOADING'&&chunkHashes){
        const received=new Set(result.uploadedChunks);
        let completed=chunkHashes.reduce((sum,_,index)=>sum+(received.has(index)?Math.min(maxBrowserMediaBytes,file.size-index*maxBrowserMediaBytes):0),0);
        setProgress(Math.round(completed/file.size*100));
        for(let index=0;index<chunkHashes.length;index++){
          if(received.has(index))continue;
          const chunk=file.slice(index*maxBrowserMediaBytes,Math.min(file.size,(index+1)*maxBrowserMediaBytes));
          setStage(`Передаём часть ${index+1} из ${chunkHashes.length}…`);
          await sendLibrarySource(`${base}/library-media/${result.id}/chunks/${index}`,chunk,mimeType,controller.signal,percent=>{
            setProgress(Math.min(100,Math.round((completed+chunk.size*percent/100)/file.size*100)));
            if(percent===100)setStage(`Сохраняем часть ${index+1} из ${chunkHashes.length}…`);
          });
          if(controller.signal.aborted)return;
          completed+=chunk.size;
        }
        setStage('Подтверждаем обработку файла…');
        status=(await api<{status:string}>(`${base}/library-media/${result.id}/confirm`,'POST')).status;
      }else if(status==='UPLOADING'){
        setStage('Передаём файл…');setProgress(0);
        status=(await sendLibrarySource(`${base}/library-media/${result.id}/source`,file,mimeType,controller.signal,percent=>{
          setProgress(percent);if(percent===100)setStage('Сохраняем файл и подтверждаем обработку…');
        })).status;
      }
      if(controller.signal.aborted)return;
      if(!['QUEUED','RUNNING','READY'].includes(status))throw new Error('Обработка этого файла уже завершилась ошибкой или файл удалён. Выберите файл заново для новой загрузки.');
      intent.current=null;setFile(null);setName('');if(input.current)input.current.value='';
      setNotice(status==='READY'?'Файл уже готов к просмотру.':'Файл принят. Проверка и подготовка выполняются в фоне.');
    }catch(failure){if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'Не удалось загрузить файл. Повторите запрос.');}
    finally{
      if(!controller.signal.aborted){active.current=null;setPending(false);setStage('');setProgress(null);await onChanged();}
    }
  }
  return <form className="panel stack" aria-label="Загрузка аудио и видео" onSubmit={event=>{event.preventDefault();void upload();}}>
    {recovery?<div className="notice"><p>Продолжение загрузки «{recovery.input.name}». Выберите исходный файл заново. Заявка действует {recovery.input.chunkHashes?'30':'5'} минут с момента создания.{recovery.input.chunkHashes?` Сохранено частей: ${recovery.uploadedChunks.length} из ${recovery.input.chunkHashes.length}. Они не будут переданы повторно.`:''}</p><button type="button" className="text-button" disabled={pending} onClick={onNewUpload}>Новая загрузка</button></div>:null}
    <label htmlFor="library-source">Аудио или видео</label>
    <input ref={input} id="library-source" type="file" accept=".mp4,.mp3,.wav,video/mp4,audio/mpeg,audio/wav" disabled={pending||!enabled} onChange={event=>{
      const selected=event.target.files?.[0]??null;setFile(selected);setName(recovery?.input.name??selected?.name??'');intent.current=recovery?.input.idempotencyKey??null;setError('');setNotice('');
    }}/>
    <label htmlFor="library-source-name">Название файла</label>
    <input id="library-source-name" value={name} maxLength={160} disabled={pending||!file||!enabled||!!recovery} onChange={event=>{setName(event.target.value);intent.current=null;}}/>
    <p className="muted">MP4, MP3 или WAV до 64 МБ и 3 минут. Большие файлы передаются по частям. Загружайте только материалы, на использование которых у вас есть права.</p>
    {error?<p className="notice error" role="alert">{error}</p>:null}
    {notice?<p className="notice success" role="status">{notice}</p>:null}
    {pending?<p role="status">{stage}</p>:null}
    {progress!==null?<progress aria-label="Передача файла" value={progress} max={100}/>:null}
    <button className="button primary" disabled={pending||!enabled||!file||!name.trim()}>{pending?'Загружаем…':recovery?'Продолжить загрузку':error&&intent.current?'Повторить загрузку':'Загрузить аудио или видео'}</button>
    {error&&intent.current?<small className="muted">Повтор доступен в течение {recovery?.input.chunkHashes||(file&&file.size>maxBrowserMediaBytes)?'30':'5'} минут с начала загрузки. После перезагрузки выберите продолжение в карточке файла. Если срок истёк, удалите незавершённую запись и выберите файл заново.</small>:null}
  </form>;
}
