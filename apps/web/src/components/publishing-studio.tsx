'use client';
import {useEffect,useRef,useState} from 'react';
import type {CalendarService,SocialService,PublishingService,VideoService} from '@contentos/core';
import {api} from '../lib/api-client';
type Entry=Awaited<ReturnType<CalendarService['list']>>[number];
type Overview=Awaited<ReturnType<PublishingService['overview']>>;
type Social=Awaited<ReturnType<SocialService['overview']>>;
const labels={SCHEDULED:'Запланировано',PREPARING:'Подготовка отправки',SUBMITTING:'Отправляется',PUBLISHED:'Опубликовано',FAILED:'Не опубликовано',CANCELLED:'Отменено',RECONCILIATION:'Требуется проверка отправки'};
export function PublishingStudio({base,canPublish}:{base:string;canPublish:boolean}){
  const [overview,setOverview]=useState<Overview|null>(null),[social,setSocial]=useState<Social|null>(null),[entries,setEntries]=useState<Entry[]>([]),[anchor,setAnchor]=useState(()=>new Date().toISOString().slice(0,10));
  const [selected,setSelected]=useState<Entry|null>(null),[connection,setConnection]=useState(''),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),[cancel,setCancel]=useState<string|null>(null);
  const [preview,setPreview]=useState<Awaited<ReturnType<VideoService['download']>>|null>(null);
  const intent=useRef<{payload:string;key:string}|null>(null);
  useEffect(()=>{let active=true;let timer:ReturnType<typeof setTimeout>;async function poll(){try{
    const from=new Date(`${anchor}T00:00:00Z`).toISOString(),to=new Date(Date.parse(from)+60*86400000).toISOString();
    const [jobs,channels,plans]=await Promise.all([api<Overview>(`${base}/publishing`),api<Social>(`${base}/social`),api<Entry[]>(`${base}/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)]);
    if(active){setOverview(jobs);setSocial(channels);setEntries(plans);}
  }catch(failure){if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить публикации');}finally{if(active)timer=setTimeout(()=>void poll(),5000);}}
  void poll();return()=>{active=false;clearTimeout(timer);};},[base,anchor,refresh]);
  async function perform(action:()=>Promise<void>){setPending(true);setError('');setNotice('');try{await action();setRefresh(value=>value+1);}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось выполнить действие');}finally{setPending(false);}}
  const candidates=entries.filter(entry=>entry.platform==='TELEGRAM'&&entry.publishingMode==='APPROVAL'&&['POST','SHORT_VIDEO'].includes(entry.type)&&!overview?.jobs.some(job=>job.calendarId===entry.id&&(job.calendarRevision===entry.revision||['SCHEDULED','PREPARING','SUBMITTING','RECONCILIATION','PUBLISHED'].includes(job.status))));
  return <section className="stack"><h2>Публикации</h2><p className="muted">Выберите материал из календаря и проверьте его перед отправкой. Поддерживаются текст и готовое видео в Telegram. Время задаётся в календаре; сохранение плана само по себе ничего не публикует.</p>
    {error?<p role="alert" className="notice error">{error}</p>:null}{notice?<p role="status" className="notice success">{notice}</p>:null}
    {!overview?<p role="status">Загружаем публикации…</p>:null}
    {overview&&!overview.configuration.ready?<p className="notice warning">Публикация не настроена на сервере. Подключения и планы можно подготовить заранее.</p>:null}
    {overview?.configuration.provider==='mock-telegram'?<p className="notice warning">ДЕМО: очередь работает локально. Сообщения в Telegram не отправляются.</p>:null}
    {canPublish?<div className="panel stack"><h3>Проверить и запланировать</h3><label>Планы начиная с даты<input aria-label="Планы начиная с даты" type="date" value={anchor} onChange={event=>{if(event.target.value)setAnchor(event.target.value);}}/></label><p className="muted">Показаны планы на следующие 60 дней. Для другой даты измените начало периода.</p>
      <label>Материал для публикации<select aria-label="Материал для публикации" value={selected?.id??''} disabled={pending} onChange={event=>{setSelected(candidates.find(entry=>entry.id===event.target.value)??null);setConfirmed(false);setPreview(null);intent.current=null;}}><option value="">Выберите материал</option>{candidates.map(entry=><option value={entry.id} key={entry.id}>{entry.title}</option>)}</select></label>
      <label>Канал публикации<select aria-label="Канал публикации" value={connection} disabled={pending} onChange={event=>{setConnection(event.target.value);setConfirmed(false);intent.current=null;}}><option value="">Выберите канал</option>{social?.connections.filter(row=>row.status==='ACTIVE').map(row=><option key={row.id} value={row.id}>{row.name}{row.username?` (@${row.username})`:''}</option>)}</select></label>
      {social?.connections.filter(row=>row.id===connection).map(row=><p className="muted" key={row.id}>Канал: {row.privacy==='PUBLIC'?'публичный':'приватный'}, комментарии {row.commentsEnabled?'включены':'выключены'}. Укажите такие же параметры в календаре.</p>)}
      {selected?<div className="stack"><h3>{selected.title}</h3><p>{new Date(selected.plannedAt).toLocaleString('ru',{timeZone:selected.timeZone})} · {selected.timeZone} · {selected.privacy==='PUBLIC'?'Публичный канал':'Приватный канал'} · Комментарии: {selected.commentsEnabled?'включены':'выключены'}</p><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{[selected.caption,selected.hashtags.map(tag=>`#${tag}`).join(' ')].filter(Boolean).join('\n\n')||'Без подписи'}</p>
        {selected.videoProjectId?<button className="button secondary" disabled={pending} onClick={()=>void perform(async()=>setPreview(await api(`${base}/videos/${selected.videoProjectId}/download`)))}>Просмотреть ролик перед публикацией</button>:null}
        {preview?<video aria-label="Видео перед публикацией" className="video-preview" controls preload="metadata" src={preview.videoUrl} poster={preview.coverUrl}/>:null}
        <p className="notice warning">Доступность и комментарии должны совпадать с настройками самого Telegram-канала. Бот не меняет их для отдельной публикации. Лимит текста — 4096 символов, подписи к видео — 1024, видео — 50 МБ.</p>
        <label><input type="checkbox" checked={confirmed} disabled={pending} onChange={event=>setConfirmed(event.target.checked)}/>Я проверил материал, канал и время отправки</label>
        <button className="button primary" disabled={pending||!confirmed||!connection||!overview?.configuration.ready} onClick={()=>void perform(async()=>{const data={calendarId:selected.id,revision:selected.revision,connectionId:connection},payload=JSON.stringify(data);if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};await api(`${base}/publishing`,'POST',{...data,idempotencyKey:intent.current.key});setSelected(null);setConfirmed(false);setPreview(null);intent.current=null;setNotice('Публикация одобрена и поставлена в очередь');})}>Одобрить и запланировать публикацию</button>
      </div>:null}
    </div>:null}
    <h3>История и очередь</h3>{overview&&!overview.jobs.length?<div className="panel empty">Публикаций пока нет.</div>:null}
    {overview?.jobs.map(job=><article key={job.id} className="panel stack"><span className="badge">{labels[job.status]}</span><h3>{job.title}</h3><p>{new Date(job.scheduledAt).toLocaleString('ru',{timeZone:job.timeZone})} · {job.timeZone}</p><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{job.caption}</p>
      {job.status==='PUBLISHED'?<p className="notice success">{job.provider==='mock-telegram'?'Демонстрационный провайдер подтвердил отправку.':'Telegram подтвердил отправку.'} {job.publishedAt?`${new Date(job.publishedAt).toLocaleString('ru',{timeZone:job.timeZone})} · ${job.timeZone}`:''} Это сохранённый результат отправки; последующее удаление сообщения в Telegram здесь не отслеживается.</p>:null}
      {job.url?<a href={job.url} target="_blank" rel="noreferrer" className="button secondary">Открыть публикацию</a>:null}
      {job.status==='RECONCILIATION'?<p className="notice warning">Не удалось достоверно определить результат отправки. Автоматический повтор заблокирован, чтобы не создать дубликат. Проверьте канал; для разрешения состояния требуется операторская проверка.</p>:null}
      {job.status==='CANCELLED'?<p className="muted">Чтобы назначить новую отправку, сохраните новую версию материала в календаре и одобрите её.</p>:null}
      {job.status==='FAILED'?<p className="notice error">Публикация не выполнена. Проверьте подключение, права, одобрение видео и параметры материала. После исправления сохраните новую версию плана и одобрите её.</p>:null}
      {canPublish&&['SCHEDULED','PREPARING'].includes(job.status)?<button className="text-button" disabled={pending} onClick={()=>setCancel(job.id)}>Отменить отправку</button>:null}
      {cancel===job.id?<div className="notice warning"><p>Отменить публикацию? Это возможно только до начала отправки в Telegram.</p><button className="button secondary" disabled={pending} onClick={()=>void perform(async()=>{await api(`${base}/publishing/${job.id}/cancel`,'POST');setCancel(null);setNotice('Отправка отменена');})}>Подтвердить отмену отправки</button><button className="text-button" onClick={()=>setCancel(null)}>Закрыть</button></div>:null}
    </article>)}
  </section>;
}
