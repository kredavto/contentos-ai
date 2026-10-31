'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import type {YouTubeResolutionQueueService} from '@contentos/core';
import {youtubeResolutionSchema} from '@contentos/types';
import {api} from '../lib/api-client';
type Tasks=Awaited<ReturnType<YouTubeResolutionQueueService['tasks']>>;
export function YouTubeResolution({ready,onResolved}:{ready:boolean;onResolved:()=>void}){
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[submitted,setSubmitted]=useState<{tenantId:string;jobId:string;id:string}|null>(null),[task,setTask]=useState<Tasks[number]|null>(null),[refresh,setRefresh]=useState(0);
  const intent=useRef<{payload:string;key:string}|null>(null),callback=useRef(onResolved),completed=useRef('');
  useEffect(()=>{callback.current=onResolved;},[onResolved]);
  useEffect(()=>{
    if(!submitted)return;let active=true,timer:ReturnType<typeof setTimeout>|undefined;const request=submitted;
    async function load(){try{
      const tasks=await api<Tasks>(`admin/youtube-resolution/tasks?tenantId=${request.tenantId}&jobId=${request.jobId}`);if(!active)return;
      const current=tasks.find(row=>row.id===request.id);if(!current)throw new Error('Задача не найдена. Обновите данные.');setTask(current);
      if(current.status==='SUCCEEDED'&&completed.current!==current.id){completed.current=current.id;callback.current();}
      if(['QUEUED','RUNNING'].includes(current.status))timer=setTimeout(()=>void load(),3000);
    }catch(failure){if(active)setError(failure instanceof Error?failure.message:'Не удалось получить статус');}}
    void load();return()=>{active=false;if(timer)clearTimeout(timer);};
  },[submitted,refresh]);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setPending(true);setError('');
    try{
      const form=new FormData(event.currentTarget),value={tenantId:String(form.get('tenantId')),jobId:String(form.get('jobId')),expectedRevision:Number(form.get('expectedRevision')),ticket:String(form.get('ticket'))},payload=JSON.stringify(value);
      if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};
      const parsed=youtubeResolutionSchema.safeParse({...value,idempotencyKey:intent.current.key});if(!parsed.success)throw new Error('Проверьте UUID организации и задания, ревизию и номер обращения.');
      const result=await api<{id:string;status:string}>('admin/youtube-resolution','POST',parsed.data);setTask(null);setSubmitted({tenantId:value.tenantId,jobId:value.jobId,id:result.id});
    }catch(failure){setError(failure instanceof Error?failure.message:'Не удалось запросить сверку');}finally{setPending(false);}
  }
  const busy=pending||!!submitted&&(!task||['QUEUED','RUNNING'].includes(task.status));
  const labels={QUEUED:'Сверка в очереди',RUNNING:'Проверяем видео у YouTube',SUCCEEDED:'Публикация подтверждена. Решение записано в аудит.',FAILED:'Сверка не завершена. Проверьте видео и причину остановки; повторная загрузка не выполнялась.',CANCELLED:'Сверка остановлена: изменились права, подключение или согласие.'};
  return <section className="panel stack"><h2>Подтвердить загруженное видео YouTube</h2><p>Скопируйте организацию, ID задания и ревизию этапа из списка сверки. Будет проверено только видео, ID которого уже сохранён. Видимость должна совпадать с одобренной; неопределённая установка обложки остаётся на ручной сверке.</p>
    {!ready?<p className="notice warning">Для сверки требуется настроенное подключение YouTube.</p>:null}
    <form onSubmit={submit} className="stack"><fieldset disabled={!ready||busy} className="stack"><legend className="sr-only">Параметры сверки YouTube</legend>
      <label>Организация для сверки YouTube<input name="tenantId" required maxLength={36}/></label>
      <label>Задание для сверки YouTube<input name="jobId" required maxLength={36}/></label>
      <label>Ревизия этапа YouTube<input name="expectedRevision" type="number" min={0} max={2147483646} step={1} required/></label>
      <label>Обращение для сверки YouTube<input name="ticket" minLength={3} maxLength={80} pattern="[A-Za-z0-9_-]{3,80}" required/></label>
      <button className="button primary">Проверить и подтвердить публикацию</button>
    </fieldset></form>
    {task?<p role="status">{labels[task.status]}{task.errorCode?` (${task.errorCode})`:''}</p>:submitted?<p role="status">Загружаем статус сверки…</p>:null}
    {task&&['FAILED','CANCELLED'].includes(task.status)?<button className="button secondary" onClick={()=>{intent.current=null;setSubmitted(null);setTask(null);setError('');}}>Новая попытка сверки</button>:null}
    {error?<p role="alert" className="notice error">{error}</p>:null}
    {submitted?<button className="text-button" onClick={()=>{setError('');setRefresh(value=>value+1);}}>Обновить статус сверки</button>:null}
  </section>;
}
