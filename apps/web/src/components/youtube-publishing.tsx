'use client';
import {useEffect,useRef,useState} from 'react';
import type {CalendarService,YouTubePublicationService,YouTubeService,VideoService} from '@contentos/core';
import {api} from '../lib/api-client';
type Overview=Awaited<ReturnType<YouTubePublicationService['overview']>>;
type Channels=Awaited<ReturnType<YouTubeService['overview']>>;
type Entry=Awaited<ReturnType<CalendarService['list']>>[number];
const states={SCHEDULED:'Запланировано',PREPARING:'Подготовка видео',SUBMITTING:'Загрузка и проверка',PUBLISHED:'Опубликовано',FAILED:'Отправка не выполнена',CANCELLED:'Отменено',RECONCILIATION:'Требуется проверка результата'};
const phases={STARTING:'Создание загрузки',UPLOADING:'Передача видео',PROCESSING:'Обработка в YouTube',THUMBNAIL:'Установка обложки',VERIFYING:'Проверка результата',COMPLETE:'Завершено'};
const privacy={PUBLIC:'Открытый доступ',UNLISTED:'Доступ по ссылке',PRIVATE:'Ограниченный доступ'};
export function YouTubePublishing({base,canPublish}:{base:string;canPublish:boolean}){
  const [overview,setOverview]=useState<Overview|null>(null),[channels,setChannels]=useState<Channels|null>(null),[entries,setEntries]=useState<Entry[]>([]),[anchor,setAnchor]=useState(()=>new Date().toISOString().slice(0,10));
  const [selectedId,setSelectedId]=useState(''),[connection,setConnection]=useState(''),[region,setRegion]=useState('RU'),[categories,setCategories]=useState<Array<{id:string;title:string}>>([]),[category,setCategory]=useState('');
  const [kids,setKids]=useState(''),[synthetic,setSynthetic]=useState(''),[cover,setCover]=useState(true),[confirmedFor,setConfirmedFor]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),[cancel,setCancel]=useState<string|null>(null);
  const [preview,setPreview]=useState<Awaited<ReturnType<VideoService['download']>>|null>(null),intent=useRef<{payload:string;key:string}|null>(null);
  useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;async function poll(){try{
    const from=new Date(`${anchor}T00:00:00Z`).toISOString(),to=new Date(Date.parse(from)+60*86400000).toISOString();
    const [jobs,connections,plans]=await Promise.all([api<Overview>(`${base}/youtube/publications`),api<Channels>(`${base}/youtube`),api<Entry[]>(`${base}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)]);
    if(active){setOverview(jobs);setChannels(connections);setEntries(plans);}
  }catch(failure){if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить публикации YouTube');}finally{if(active)timer=setTimeout(()=>void poll(),5000);}}
  void poll();return()=>{active=false;clearTimeout(timer);};},[base,anchor,refresh]);
  async function perform(action:()=>Promise<void>){setPending(true);setError('');setNotice('');try{await action();setRefresh(value=>value+1);}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось выполнить действие');}finally{setPending(false);}}
  const candidates=entries.filter(entry=>entry.platform==='YOUTUBE'&&entry.type==='SHORT_VIDEO'&&entry.publishingMode==='APPROVAL'&&entry.videoProjectId&&!overview?.jobs.some(job=>job.calendarId===entry.id&&(job.calendarRevision===entry.revision||['SCHEDULED','PREPARING','SUBMITTING','RECONCILIATION','PUBLISHED'].includes(job.status))));
  const selected=candidates.find(entry=>entry.id===selectedId),fingerprint=JSON.stringify({calendarId:selected?.id,revision:selected?.revision,connection,region,category,kids,synthetic,cover});
  const readyVideo=selected?.videoStage==='READY'&&selected.videoLifecycle==='ACTIVE'&&!!selected.videoApprovedAt;
  return <section className="stack" aria-label="Публикации YouTube"><h2>YouTube</h2><p>Выберите одобренное видео из календаря. Сохранение плана само по себе ничего не отправляет. Поддерживаются файлы до 256 МиБ.</p>
    {error?<p role="alert" className="notice error">{error}</p>:null}{notice?<p role="status" className="notice success">{notice}</p>:null}
    {!overview?<p role="status">Загружаем публикации YouTube…</p>:null}
    {overview?.demo?<p className="notice warning">ДЕМО: тестовая публикация. Google не вызывается, видео не появляется на YouTube.</p>:null}
    {overview&&!overview.configuration.ready?<p className="notice warning">Отправка YouTube не настроена. Нужны приложение Google и защищённое хранилище видео и доступа.</p>:null}
    <button className="button secondary" disabled={pending} onClick={()=>{setError('');setRefresh(value=>value+1);}}>Обновить публикации YouTube</button>
    {canPublish?<div className="panel stack"><h3>Одобрить видео для YouTube</h3>
      <label>Планы YouTube начиная с даты<input type="date" value={anchor} onChange={event=>{if(event.target.value)setAnchor(event.target.value);}}/></label><p className="muted">Показаны следующие 60 дней. Время и доступность видео меняются в календаре.</p>
      <label>Видео для YouTube<select aria-label="Видео для YouTube" value={selectedId} disabled={pending} onChange={event=>{setSelectedId(event.target.value);setPreview(null);setConfirmedFor('');}}><option value="">Выберите видео</option>{candidates.map(entry=><option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
      <label>Канал YouTube<select aria-label="Канал YouTube" value={connection} disabled={pending} onChange={event=>{setConnection(event.target.value);setCategories([]);setCategory('');}}><option value="">Выберите канал</option>{channels?.connections.filter(row=>row.status==='ACTIVE').map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      {selected?<div className="stack"><h4>{selected.title}</h4><p>{new Date(selected.plannedAt).toLocaleString('ru',{timeZone:selected.timeZone})} · {selected.timeZone} · {privacy[selected.privacy]}</p><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{[selected.caption.trim(),selected.hashtags.map(tag=>`#${tag}`).join(' ')].filter(Boolean).join('\n\n')}</p>
        {!readyVideo?<p className="notice warning">Видео должно быть готово и одобрено в разделе «Видео».</p>:null}
        <button className="button secondary" disabled={pending||!readyVideo} onClick={()=>void perform(async()=>setPreview(await api(`${base}/videos/${selected.videoProjectId}/download`)))}>Просмотреть видео для YouTube</button>
        {preview?<video aria-label="Предпросмотр YouTube" className="video-preview" controls preload="metadata" src={preview.videoUrl} poster={preview.coverUrl}/>:null}
        <label>Регион каталога категорий<input value={region} maxLength={2} disabled={pending} onChange={event=>{setRegion(event.target.value.toUpperCase());setCategory('');setCategories([]);}} placeholder="RU или US"/></label>
        <button className="button secondary" disabled={pending||!connection||!overview?.configuration.ready||!/^[A-Z]{2}$/.test(region)} onClick={()=>void perform(async()=>{const loaded=await api<Array<{id:string;title:string}>>(`${base}/youtube/categories?connectionId=${encodeURIComponent(connection)}&regionCode=${encodeURIComponent(region)}`);setCategories(loaded);setCategory('');if(!loaded.length)setNotice('В выбранном регионе нет доступных категорий');})}>Загрузить категории YouTube</button>
        <label>Категория YouTube<select aria-label="Категория YouTube" disabled={pending||!categories.length} value={category} onChange={event=>setCategory(event.target.value)}><option value="">Выберите категорию</option>{categories.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
        <label>Видео предназначено для детей?<select aria-label="Видео предназначено для детей?" disabled={pending} value={kids} onChange={event=>setKids(event.target.value)}><option value="">Укажите аудиторию</option><option value="yes">Да</option><option value="no">Нет</option></select></label>
        <label>Есть изменённый или синтетический контент?<select aria-label="Есть изменённый или синтетический контент?" disabled={pending} value={synthetic} onChange={event=>setSynthetic(event.target.value)}><option value="">Укажите наличие</option><option value="yes">Да</option><option value="no">Нет</option></select></label>
        <label><input type="checkbox" checked={cover} disabled={pending} onChange={event=>setCover(event.target.checked)}/>Установить одобренную обложку</label>
        <p className="muted">Комментарии настраиваются в YouTube: параметр календаря не изменяет их. Для собственной обложки канал должен поддерживать её загрузку.</p>
        <label><input type="checkbox" disabled={pending} checked={confirmedFor===fingerprint} onChange={event=>setConfirmedFor(event.target.checked?fingerprint:'')}/>Я проверил видео, канал, время, доступность и декларации YouTube</label>
        <button className="button primary" disabled={pending||!overview?.configuration.ready||!readyVideo||!connection||!category||!kids||!synthetic||confirmedFor!==fingerprint} onClick={()=>void perform(async()=>{const data={calendarId:selected.id,revision:selected.revision,connectionId:connection,regionCode:region,youtube:{categoryId:category,madeForKids:kids==='yes',containsSyntheticMedia:synthetic==='yes',uploadCover:cover}},payload=JSON.stringify(data);if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};await api(`${base}/youtube/publications`,'POST',{...data,idempotencyKey:intent.current.key});setSelectedId('');setConfirmedFor('');setPreview(null);intent.current=null;setNotice('Видео одобрено и поставлено в очередь YouTube');})}>Одобрить и запланировать YouTube</button>
      </div>:null}
    </div>:null}
    <h3>Очередь YouTube</h3>{overview&&!overview.jobs.length?<p>Публикаций YouTube пока нет.</p>:null}
    {overview?.jobs.map(job=><article className="panel stack" key={job.id}><span className="badge">{states[job.status]}</span><h4>{job.title}</h4><p>{new Date(job.scheduledAt).toLocaleString('ru',{timeZone:job.timeZone})} · {job.timeZone}</p>
      {job.uploadPhase&&job.status==='SUBMITTING'?<p>{phases[job.uploadPhase]}</p>:null}
      {job.totalBytes!=null&&job.uploadedBytes!=null&&job.status==='SUBMITTING'?<><progress aria-label="Передача видео в YouTube" max={job.totalBytes} value={job.uploadedBytes}/><p>Передано {(job.uploadedBytes/1048576).toFixed(1)} из {(job.totalBytes/1048576).toFixed(1)} МиБ. Публикация подтверждается после обработки и проверки.</p></>:null}
      {job.status==='PUBLISHED'?<p className="notice success">{overview.demo?'ДЕМО: тестовый адаптер подтвердил завершение. Видео не опубликовано в Google.':'YouTube подтвердил обработку и выбранную доступность. Это сохранённый результат; последующие изменения в YouTube здесь не отслеживаются.'}</p>:null}
      {job.url?<a className="button secondary" href={job.url} target="_blank" rel="noreferrer">Открыть видео YouTube</a>:null}
      {job.status==='RECONCILIATION'?<div className="notice warning"><p>Результат требует проверки. Видео уже могло появиться на канале. Автоматическая повторная отправка заблокирована; требуется операторская сверка.</p>{job.reviewUrl?<a href={job.reviewUrl} target="_blank" rel="noreferrer">Проверить известное видео на YouTube</a>:null}</div>:null}
      {job.status==='FAILED'?<p className="notice error">Отправка не выполнена. Проверьте доступ к каналу, согласия и одобрение видео. После исправления сохраните новую версию плана и одобрите её.</p>:null}
      {job.status==='CANCELLED'?<p>Отправка отменена. Для нового одобрения сохраните новую версию плана в календаре.</p>:null}
      {canPublish&&['SCHEDULED','PREPARING'].includes(job.status)?<button className="text-button" disabled={pending} onClick={()=>setCancel(job.id)}>Отменить YouTube</button>:null}
      {cancel===job.id?<div className="notice warning"><p>Отменить отправку до начала загрузки в YouTube?</p><button className="button secondary" disabled={pending} onClick={()=>void perform(async()=>{await api(`${base}/publishing/${job.id}/cancel`,'POST');setCancel(null);setNotice('Отправка YouTube отменена');})}>Подтвердить отмену YouTube</button><button className="text-button" onClick={()=>setCancel(null)}>Закрыть</button></div>:null}
    </article>)}
  </section>;
}
