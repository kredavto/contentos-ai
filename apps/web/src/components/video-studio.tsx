'use client';
import {useEffect,useRef,useState} from 'react';
import type {AvatarService,GenerationService,VideoService} from '@contentos/core';
import {videoReservationSeconds,type VideoRequest,type VideoStage} from '@contentos/types';
import {api} from '../lib/api-client';
import {CaptionEditor} from './caption-editor';
type Overview=Awaited<ReturnType<VideoService['overview']>>;
type Avatars=Awaited<ReturnType<AvatarService['overview']>>;
type Scripts=Awaited<ReturnType<GenerationService['overview']>>['scripts'];
const stages:Record<VideoStage,string>={VIDEO_REQUESTED:'В очереди',VOICE_PREPARING:'Подготовка голоса',AVATAR_RENDERING:'Генерация аватара',POST_PROCESSING:'Обработка видео',CAPTIONS_GENERATING:'Субтитры',BROLL_PROCESSING:'B-roll',COVER_GENERATING:'Создание обложки',QC:'Проверка качества',READY:'Готово',FAILED:'Ошибка'};
export function VideoStudio({base,scripts,canWrite,canApprove,canManage,maximum,available,captionCost,aiAvailable}:{base:string;scripts:Scripts;canWrite:boolean;canApprove:boolean;canManage:boolean;maximum?:number;available:number;captionCost?:number;aiAvailable:number}){
  const [data,setData]=useState<Overview|null>(null),[avatars,setAvatars]=useState<Avatars|null>(null);
  const [scriptId,setScriptId]=useState(''),[lookId,setLookId]=useState('');
  const [orientation,setOrientation]=useState<VideoRequest['orientation']>('9:16'),[resolution,setResolution]=useState<VideoRequest['resolution']>('720p'),[fit,setFit]=useState<VideoRequest['fit']>('crop');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState(false);
  const [preview,setPreview]=useState<({id:string}&Awaited<ReturnType<VideoService['download']>>)|null>(null);
  const [history,setHistory]=useState<{id:string;items:Awaited<ReturnType<VideoService['history']>>}|null>(null);
  const [captionMode,setCaptionMode]=useState<VideoRequest['captionMode']>('NONE');
  const [captionReview,setCaptionReview]=useState<{id:string;data:Awaited<ReturnType<VideoService['captionReview']>>}|null>(null);
  const [deleting,setDeleting]=useState<string|null>(null);
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
      const payload=JSON.stringify({scriptId:script.id,scriptVersion:script.currentVersion,lookId:look.id,orientation,resolution,fit,captionMode,captionLanguage:'ru'});
      if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};
      await api(`${base}/videos`,'POST',{...JSON.parse(payload),idempotencyKey:intent.current.key});intent.current=null;setNotice('Видео добавлено в очередь');
    });}}>
      <label>Одобренный сценарий<select aria-label="Одобренный сценарий" required value={scriptId} onChange={event=>setScriptId(event.target.value)}><option value="">Выберите сценарий</option>{approved.map(item=><option value={item.id} key={item.id}>{item.content.hook.slice(0,70)} · v{item.currentVersion}</option>)}</select></label>
      <label>Образ аватара<select aria-label="Образ аватара" required value={lookId} onChange={event=>setLookId(event.target.value)}><option value="">Выберите образ с голосом</option>{looks.map(item=><option value={item.id} key={item.id}>{item.avatarName} · {item.name}</option>)}</select></label>
      {!approved.length?<p className="notice warning">Сначала одобрите сценарий в разделе «Сценарии».</p>:null}
      {!looks.length?<p className="notice warning">В разделе «Аватары» создайте образ и выберите для него голос.</p>:null}
      <div className="studio-form"><label>Формат<select aria-label="Формат видео" value={orientation} onChange={event=>setOrientation(event.target.value as typeof orientation)}><option>9:16</option><option>1:1</option><option>16:9</option></select></label><label>Разрешение<select aria-label="Разрешение видео" value={resolution} onChange={event=>setResolution(event.target.value as typeof resolution)}><option>720p</option><option>1080p</option></select></label><label>Кадрирование<select aria-label="Кадрирование" value={fit} onChange={event=>setFit(event.target.value as typeof fit)}><option value="crop">Заполнить кадр</option><option value="contain">Сохранить весь кадр</option></select></label></div>
      <label>Субтитры<select aria-label="Субтитры" value={captionMode} onChange={event=>setCaptionMode(event.target.value as typeof captionMode)}><option value="NONE">Без субтитров</option><option value="MANUAL">Добавить вручную</option><option value="AUTO" disabled={!data?.configuration.captionsReady}>Распознать русский язык</option></select></label><p className="muted">Перед финальным рендером можно проверить и исправить субтитры. Обложка — первый кадр. B-roll и музыка пока не подключены. Водяной знак не добавляется.</p>
      {captionMode==='AUTO'?<p>Дополнительный резерв за распознавание: {captionCost??'—'} AI-кредитов. Спишется после успешного финального рендера.</p>:null}
      {budget?<p>Резерв: <strong>{budget} видеосекунд</strong>. После проверки спишется фактическая длительность с округлением вверх до секунды, остаток вернётся. Ролик длиннее резерва завершится ошибкой без списания.</p>:null}
      {budget&&available<budget?<p className="notice warning">Недостаточно видеосекунд: доступно {available}, требуется {budget}.</p>:null}
      <button className="button primary" disabled={pending||!data?.configuration.ready||!script||!look||!budget||available<budget||(captionMode==='AUTO'&&(!captionCost||aiAvailable<captionCost))}>Создать видео</button>
    </form>:null}
    {data&&!data.projects.length?<div className="panel empty">Здесь появятся готовые ролики и задачи генерации.</div>:null}
    <div className="plan-grid">{data?.projects.map(project=><article className="panel stack" key={project.id}>
      <span className="badge">{project.lifecycle==='DELETE_PENDING'?'Удаляется':project.approvedAt?'Одобрено':project.jobStatus==='WAITING_REVIEW'?'Проверьте субтитры':stages[project.stage]}</span><h3>{project.title}</h3><p className="muted">{project.options.orientation} · {project.options.resolution} · {project.durationMs?`${(project.durationMs/1000).toFixed(1)} сек.`:'Длительность определяется после обработки'}</p>
      {project.jobStatus==='RECONCILIATION'?<p className="notice warning">Результат требует проверки. Резерв сохранён; не создавайте дубликат этой задачи.</p>:null}
      {project.jobStatus==='RETRY'?<p className="muted">Повторная попытка обработки…</p>:null}
      {project.stage==='FAILED'?<p className="notice error">{project.errorCode}. Зарезервированные видеосекунды возвращены.</p>:null}
      {preview?.id===project.id&&project.lifecycle==='ACTIVE'?<video className="video-preview" aria-label="Готовый ролик" controls preload="metadata" src={preview.videoUrl} poster={preview.coverUrl}/>:null}
      {project.lifecycle==='DELETE_PENDING'?<p className="notice warning">{project.deleteError==='RECONCILIATION_REQUIRED'?'Исход запроса неизвестен. Доступ закрыт; удаление у провайдера требует проверки.':'Доступ закрыт. Файлы удаляются у провайдера и в хранилище; при ошибке операция повторится.'}</p>:null}
      {captionReview?.id===project.id&&project.lifecycle==='ACTIVE'?<CaptionEditor key={project.id} base={`${base}/videos/${project.id}/captions`} initial={captionReview.data} onDone={()=>{setCaptionReview(null);void perform(async()=>{});}}/>:null}
      <div className="studio-actions">
        {project.jobStatus==='WAITING_REVIEW'&&project.lifecycle==='ACTIVE'&&canWrite?<button className="button primary" disabled={pending} onClick={()=>void perform(async()=>setCaptionReview({id:project.id,data:await api(`${base}/videos/${project.id}/captions`)}))}>Редактировать субтитры</button>:null}
        {project.jobStatus==='RECONCILIATION'&&project.captionMode==='AUTO'&&project.captionMutationState==='UNKNOWN'&&project.lifecycle==='ACTIVE'&&canWrite?<button className="button secondary" disabled={pending} onClick={()=>void perform(async()=>{await api(`${base}/videos/${project.id}/manual-captions`,'POST');setNotice('Резерв за распознавание возвращён. Добавьте субтитры вручную.');})}>Продолжить с ручными субтитрами</button>:null}

        {project.stage==='READY'&&project.lifecycle==='ACTIVE'?<><button className="button secondary" disabled={pending} onClick={()=>void perform(async()=>setPreview({id:project.id,...await api<Awaited<ReturnType<VideoService['download']>>>(`${base}/videos/${project.id}/download`)}))}>Смотреть видео</button><button className="button primary" disabled={pending||!canApprove||!!project.approvedAt} onClick={()=>void perform(async()=>{await api(`${base}/videos/${project.id}/approve`,'POST');setNotice('Видео одобрено');})}>Одобрить видео</button></>:null}
        {project.jobStatus==='RECONCILIATION'&&project.lifecycle==='ACTIVE'&&canManage&&!(project.captionMode==='AUTO'&&project.captionMutationState==='UNKNOWN')?<button className="button secondary" disabled={pending} onClick={()=>void perform(async()=>{await api(`${base}/videos/${project.id}/resume`,'POST');setNotice('Проверка возобновлена');})}>Повторить проверку</button>:null}
        {project.lifecycle==='ACTIVE'&&canWrite?<button className="text-button" disabled={pending} onClick={()=>setDeleting(project.id)}>Удалить видео</button>:null}
        <button className="text-button" disabled={pending} onClick={()=>void perform(async()=>setHistory({id:project.id,items:await api(`${base}/videos/${project.id}/history`)}))}>История обработки</button>
      </div>
      {deleting===project.id&&project.lifecycle==='ACTIVE'?<div className="notice warning"><p>Удалить исходник, готовое видео и обложку? Это действие необратимо. Секунды за уже готовое видео не возвращаются.</p><div className="studio-actions"><button className="button secondary" disabled={pending} onClick={()=>setDeleting(null)}>Отмена</button><button className="button primary" disabled={pending} onClick={()=>void perform(async()=>{await api(`${base}/videos/${project.id}/delete`,'POST');setDeleting(null);if(preview?.id===project.id)setPreview(null);setNotice('Видео поставлено на удаление');})}>Подтвердить удаление видео</button></div></div>:null}
      {history?.id===project.id?<ol>{history.items.map(item=><li key={item.revision}>{stages[item.to]}{item.details.mode==='disabled'?' — отключено':''}</li>)}</ol>:null}
    </article>)}</div>
  </section>;
}
