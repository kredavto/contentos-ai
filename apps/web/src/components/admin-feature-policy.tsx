'use client';
import {useEffect,useRef,useState} from 'react';
import {managedFeatures,type ManagedFeature,type FeatureTarget,type FeaturePolicyChange,featurePolicyChangeSchema} from '@contentos/types';
import type {FeaturePolicyService} from '@contentos/core';
import {api} from '../lib/api-client';
type Inspection=Awaited<ReturnType<FeaturePolicyService['inspect']>>;
const names:Record<ManagedFeature,string>={avatar_generation:'Генерация аватаров',video_generation:'Генерация видео',trend_radar:'Поиск трендов',instagram_publishing:'Публикация в Instagram',tiktok_publishing:'Публикация в TikTok',youtube_publishing:'Публикация в YouTube',telegram_publishing:'Публикация в Telegram',autopilot:'Автопилот',comments:'Комментарии',analytics_ai:'AI-аналитика',agency_mode:'Агентский режим',byok:'Собственные ключи провайдеров'};
export function AdminFeaturePolicy(){
 const [feature,setFeature]=useState<ManagedFeature>('avatar_generation'),[scope,setScope]=useState<FeatureTarget['scope']>('GLOBAL'),[targetId,setTargetId]=useState(''),[data,setData]=useState<Inspection|null>(null),[mode,setMode]=useState<FeaturePolicyChange['mode']>('INHERIT'),[ticket,setTicket]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState('');
 const [planTargets,setPlanTargets]=useState<Array<{planId:string;code:string;name:string}>>([]);
 const intent=useRef<string|null>(null),read=useRef<AbortController|null>(null);
 useEffect(()=>()=>read.current?.abort(),[]);
 function changed(){setData(null);setError('');intent.current=null;}
 async function inspect(){setPending(true);setError('');read.current?.abort();const abort=new AbortController();read.current=abort;
  try{const query=new URLSearchParams({feature,scope,...(scope==='GLOBAL'?{}:{targetId})});const result=await api<Inspection>(`admin/feature-policy?${query}`,'GET',undefined,abort.signal);setData(result);setMode(result.mode);intent.current=null;}
  catch(failure){if(!abort.signal.aborted)setError(failure instanceof Error?failure.message:'Не удалось прочитать правило');}finally{if(!abort.signal.aborted)setPending(false);}
 }
 async function loadPlans(){setPending(true);setError('');read.current?.abort();const abort=new AbortController();read.current=abort;
  try{const result=await api<{plans:Array<{planId:string;code:string;name:string}>}>('admin/plans','GET',undefined,abort.signal);setPlanTargets(result.plans);}
  catch(failure){if(!abort.signal.aborted)setError(failure instanceof Error?failure.message:'Не удалось загрузить тарифы');}finally{if(!abort.signal.aborted)setPending(false);}
 }
 async function save(){if(!data?.canManage)return;intent.current??=crypto.randomUUID();
  const parsed=featurePolicyChangeSchema.safeParse({...data.target,mode,expectedRevision:data.revision,ticket,idempotencyKey:intent.current});if(!parsed.success){setError('Укажите номер обращения: 3–80 латинских букв, цифр, дефисов или подчёркиваний.');return;}
  setPending(true);setError('');try{await api('admin/feature-policy','POST',parsed.data);await inspect();}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось сохранить правило');}finally{setPending(false);}
 }
 return <section className="panel brand-profile-editor" aria-label="Управление доступностью функций"><h2>Доступность функций</h2>
  <p>Правило пользователя имеет приоритет над организацией, затем тарифом и общим правилом. Наследование снимает выбранное переопределение. Разрешение функции сохраняет проверки роли, согласий, баланса и серверной конфигурации. Правило не подключает отсутствующую интеграцию.</p>
  <p>Изменения проверяются при новых запросах и в контрольных точках очереди. Уже начатую операцию у провайдера остановить этим переключателем нельзя.</p>
  <form onSubmit={event=>{event.preventDefault();void inspect();}}>
   <label>Функция<select aria-label="Функция" value={feature} disabled={pending} onChange={event=>{setFeature(event.target.value as ManagedFeature);changed();}}>{managedFeatures.map(name=><option key={name} value={name}>{names[name]}</option>)}</select></label>
   <label>Область правила<select aria-label="Область правила" value={scope} disabled={pending} onChange={event=>{const next=event.target.value as FeatureTarget['scope'];setScope(next);setTargetId('');changed();if(next==='PLAN')void loadPlans();}}><option value="GLOBAL">Общее правило</option><option value="PLAN">Тариф</option><option value="ORGANIZATION">Организация</option><option value="USER">Пользователь</option></select></label>
   {scope==='PLAN'?<label>Тариф для правила<select aria-label="Тариф для правила" value={targetId} required disabled={pending} onChange={event=>{setTargetId(event.target.value);changed();}}><option value="">Выберите тариф</option>{planTargets.map(plan=><option key={plan.planId} value={plan.planId}>{plan.name} ({plan.code})</option>)}</select></label>:scope!=='GLOBAL'?<label>ID области правила<input value={targetId} required maxLength={36} disabled={pending} onChange={event=>{setTargetId(event.target.value);changed();}}/></label>:null}
   {scope==='PLAN'&&!planTargets.length?<button type="button" className="button secondary" disabled={pending} onClick={()=>{void loadPlans();}}>Загрузить тарифы</button>:null}
   <button className="button secondary" disabled={pending}>{pending?'Проверяем…':'Прочитать правило'}</button>
  </form>
  {data?<><p role="status">Правило прочитано. Ревизия: {data.revision}.</p><form onSubmit={event=>{event.preventDefault();void save();}}>
   <label>Состояние функции<select aria-label="Состояние функции" value={mode} disabled={pending||!data.canManage} onChange={event=>{setMode(event.target.value as FeaturePolicyChange['mode']);intent.current=null;}}><option value="INHERIT">Наследовать</option><option value="ENABLED">Разрешить</option><option value="DISABLED">Отключить</option></select></label>
   <label>Обращение для изменения функции<input value={ticket} required minLength={3} maxLength={80} disabled={pending||!data.canManage} onChange={event=>{setTicket(event.target.value);intent.current=null;}}/></label>
   <button className="button secondary" disabled={pending||!data.canManage}>Сохранить правило</button>
  </form>{!data.canManage?<p>SUPPORT может только просматривать правила.</p>:null}
  {data.changes.length?<><h3>История правила</h3><ul>{data.changes.map(change=><li key={change.id}>Ревизия {change.revision} · {change.mode==='INHERIT'?'наследовать':change.mode==='ENABLED'?'разрешено':'отключено'} · {change.ticket} · {new Date(change.createdAt).toLocaleString('ru-RU')}</li>)}</ul>{data.hasMoreChanges?<p>Показаны последние 10 изменений. Полная история сохранена.</p>:null}</>:null}</>:null}
  {error?<p role="alert">{error}</p>:null}
 </section>;
}
