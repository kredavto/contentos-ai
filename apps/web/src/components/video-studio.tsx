'use client';
import {useEffect,useRef,useState} from 'react';
import type {AvatarService,GenerationService,VideoService} from '@contentos/core';
import {videoReservationSeconds,type VideoRequest,type VideoStage} from '@contentos/types';
import {api} from '../lib/api-client';
type Overview=Awaited<ReturnType<VideoService['overview']>>;
type Avatars=Awaited<ReturnType<AvatarService['overview']>>;
type Scripts=Awaited<ReturnType<GenerationService['overview']>>['scripts'];
const stages:Record<VideoStage,string>={VIDEO_REQUESTED:'В очереди',VOICE_PREPARING:'Подготовка голоса',AVATAR_RENDERING:'Генерация аватара',POST_PROCESSING:'Обработка видео',CAPTIONS_GENERATING:'Субтитры',BROLL_PROCESSING:'B-roll',COVER_GENERATING:'Создание обложки',QC:'Проверка качества',READY:'Готово',FAILED:'Ошибка'};
export function VideoStudio({base,scripts,canWrite,canApprove,maximum,available}:{base:string;scripts:Scripts;canWrite:boolean;canApprove:boolean;maximum?:number;available:number}){
  const [data,setData]=useState<Overview|null>(null),[avatars,setAvatars]=useState<Avatars|null>(null);
  const [scriptId,setScriptId]=useState(''),[lookId,setLookId]=useState('');
  const [orientation,setOrientation]=useState<VideoRequest['orientation']>('9:16'),[resolution,setResolution]=useState<VideoRequest['resolution']>('720p'),[fit,setFit]=useState<VideoRequest['fit']>('crop');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false);
  const [preview,setPreview]=useState<({id:string}&Awaited<ReturnType<VideoService['download']>>)|null>(null);
  const [history,setHistory]=useState<{id:string;items:Awaited<ReturnType<VideoService['history']>>}|null>(null);
  const intent=useRef<{payload:string;key:string}|null>(null);
  useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;async function poll(){try{
    const [projects,looks]=await Promise.all([api<Overview>(`${base}/videos`),api<Avatars>(`${base}/avatars`)]);
    if(active){setData(projects);setAvatars(looks);}
  }catch(failure){if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить видео');}finally{if(active)timer=setTimeout(()=>void poll(),5000);}}
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[base]);
  async function perform(action:()=>Promise<void>){setPending(true);setError('');setNotice('');try{await action();setData(await api<Overview>(`${base}/videos`));}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось выполнить действие');}finally{setPending(false);}}
  const approved=scripts.filter(script=>script.currentVersion===script.approvedVersion);
  const script=approved.find(item=>item.id===scriptId),budget=script&&maximum?videoReservationSeconds(script.duration,maximum):undefined;
  const looks=avatars?.looks.filter(look=>look.status==='READY'&&look.avatarStatus==='ACTIVE'&&look.consentValid&&look.voiceId)??[];
  const look=looks.find(item=>item.id===lookId);
  return <section><h2>Видеостудия</h2><p className="muted">Одобренный сценарий, выбранный аватар и голос превращаются в готовый ролик. Исходный рендер и финальное видео сохраняются отдельно.</p>
    {error?<p className="notice error" role="alert">{error}</p>:null}{notice?<p className="notice success" role="status">{notice}</p>:null}
    {!data?<p role="status">Загружаем видеопроекты…</p>:null}
    {data?.configuration.provider==='mock-avatar'?<p className="notice warning">ДЕМО: используется тестовый ролик. Это не видео с вашим аватаром.</p>:null}
    {data&&!data.configuration.ready?<p className="notice warning">Генерация видео ещё не подключена. Требуется настройка видеопровайдера, хранилища и фонового обработчика.</p>:null}
    {canWrite?<form className="panel stack" onSubmit={event=>{event.preventDefault();if(!script||!look)return;void perform(async()=>{
      const payload=JSON.stringify({scriptId:script.id,scriptVersion:script.currentVersion,lookId:look.id,orientation,resolution,fit});
      if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};
      await api(`${base}/videos`,'POST',{...JSON.parse(payload),idempotencyKey:intent.current.key});intent.current=null;setNotice('Видео добавлено в очередь');
    });}}>
      <label>Одобренный сценарий<select aria-label="Одобренный сценарий" required value={scriptId} onChange={event=>setScriptId(event.target.value)}><option value="">Выберите сценарий</option>{approved.map(item=><option value={item.id} key={item.id}>{item.content.hook.slice(0,70)} · v{item.currentVersion}</option>)}</select></label>
      <label>Образ аватара<select aria-label="Образ аватара" required value={lookId} onChange={event=>setLookId(event.target.value)}><option value="">Выберите образ с голосом</option>{looks.map(item=><option value={item.id} key={item.id}>{item.avatarName} · {item.name}</option>)}</select></label>
      {!approved.length?<p className="notice warning">Сначала одобрите сценарий в разделе «Сценарии».</p>:null}
      {!looks.length?<p className="notice warning">В разделе «Аватары» создайте образ и выберите для него голос.</p>:null}
      <div className="studio-form"><label>Формат<select aria-label="Формат видео" value={orientation} onChange={event=>setOrientation(event.target.value as typeof orientation)}><option>9:16</option><option>1:1</option><option>16:9</option></select></label><label>Разрешение<select aria-label="Разрешение видео" value={resolution} onChange={event=>setResolution(event.target.value as typeof resolution)}><option>720p</option><option>1080p</option></select></label><label>Кадрирование<select aria-label="Кадрирование" value={fit} onChange={event=>setFit(event.target.value as typeof fit)}><option value="crop">Заполнить кадр</option><option value="contain">Сохранить весь кадр</option></select></label></div>
      <p className="muted">Обложка — первый кадр. Автоматические субтитры, B-roll и музыка пока не подключены. Водяной знак не добавляется.</p>
      {budget?<p>Резерв: <strong>{budget} видеосекунд</strong>. После проверки спишется фактическая длительность с округлением вверх до секунды, остаток вернётся. Ролик длиннее резерва завершится ошибкой без списания.</p>:null}
      {budget&&available<budget?<p className="notice warning">Недостаточно видеосекунд: доступно {available}, требуется {budget}.</p>:null}
      <button className="button primary" disabled={pending||!data?.configuration.ready||!script||!look||!budget||available<budget}>Создать видео</button>
    </form>:null}
    {data&&!data.projects.length?<div className="panel empty">Здесь появятся готовые ролики и задачи генерации.</div>:null}
    <div className="plan-grid">{data?.projects.map(project=><article className="panel stack" key={project.id}>
      <span className="badge">{project.approvedAt?'Одобрено':stages[project.stage]}</span><h3>{project.title}</h3><p className="muted">{project.options.orientation} · {project.options.resolution} · {project.durationMs?`${(project.durationMs/1000).toFixed(1)} сек.`:'Длительность определяется после обработки'}</p>
      {project.jobStatus==='RECONCILIATION'?<p className="notice warning">Результат требует проверки. Резерв сохранён; не создавайте дубликат этой задачи.</p>:null}
      {project.jobStatus==='RETRY'?<p className="muted">Повторная попытка обработки…</p>:null}
      {project.stage==='FAILED'?<p className="notice error">{project.errorCode}. Зарезервированные видеосекунды возвращены.</p>:null}
      {preview?.id===project.id?<video className="video-preview" aria-label="Готовый ролик" controls preload="metadata" src={preview.videoUrl} poster={preview.coverUrl}/>:null}
      <div className="studio-actions">
        {project.stage==='READY'?<><button className="button secondary" disabled={pending} onClick={()=>void perform(async()=>setPreview({id:project.id,...await api<Awaited<ReturnType<VideoService['download']>>>(`${base}/videos/${project.id}/download`)}))}>Смотреть видео</button><button className="button primary" disabled={pending||!canApprove||!!project.approvedAt} onClick={()=>void perform(async()=>{await api(`${base}/videos/${project.id}/approve`,'POST');setNotice('Видео одобрено');})}>Одобрить видео</button></>:null}
        <button className="text-button" disabled={pending} onClick={()=>void perform(async()=>setHistory({id:project.id,items:await api(`${base}/videos/${project.id}/history`)}))}>История обработки</button>
      </div>
      {history?.id===project.id?<ol>{history.items.map(item=><li key={item.revision}>{stages[item.to]}{item.details.mode==='disabled'?' — отключено':''}</li>)}</ol>:null}
    </article>)}</div>
  </section>;
}
