'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api-client';
type Notice={id:string;title:string;body:string;href:string;createdAt:string;readAt:string|null};
type Feed={items:Notice[];unread:number;nextCursor:string|null};
export function NotificationLink({tenantId}:{tenantId:string}){
  const [unread,setUnread]=useState<number|null>(null);
  useEffect(()=>{let active=true;setUnread(null);const refresh=()=>{void api<Feed>(`organizations/${tenantId}/notifications`).then(value=>{if(active)setUnread(value.unread);}).catch(()=>{if(active)setUnread(null);});};refresh();const timer=setInterval(refresh,30000);return()=>{active=false;clearInterval(timer);};},[tenantId]);
  return <Link className="button secondary" href={`/notifications?organization=${tenantId}`} title={unread===null?'Счётчик недоступен — откройте уведомления':undefined}>Уведомления{unread!==null&&unread>0?` · ${unread}`:''}</Link>;
}
export function NotificationCenter({tenantId}:{tenantId:string}){
  const [feed,setFeed]=useState<Feed|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const base=`organizations/${tenantId}/notifications`;
  const refresh=useCallback(async()=>{setPending(true);setError('');try{setFeed(await api<Feed>(base));}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось загрузить уведомления');}finally{setPending(false);}},[base]);
  useEffect(()=>{let active=true;api<Feed>(base).then(value=>{if(active)setFeed(value);}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить уведомления');});return()=>{active=false;};},[base]);
  async function more(){if(!feed?.nextCursor||pending)return;setPending(true);setError('');try{const next=await api<Feed>(`${base}?cursor=${feed.nextCursor}`);setFeed(current=>({...next,items:[...new Map([...(current?.items??[]),...next.items].map(item=>[item.id,item])).values()]}));}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось загрузить страницу');}finally{setPending(false);}}
  async function read(id:string){setPending(true);setError('');try{const result=await api<{readAt:string}>(`${base}/read`,'POST',{id});setFeed(current=>current?{...current,unread:Math.max(0,current.unread-(current.items.some(item=>item.id===id&&!item.readAt)?1:0)),items:current.items.map(item=>item.id===id?{...item,readAt:result.readAt}:item)}:current);}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось отметить уведомление');}finally{setPending(false);}}
  return <main className="workspace-main content-studio"><Link className="back-link" href="/dashboard">← Рабочее пространство</Link><div className="page-title"><div><h1>Уведомления</h1><p className="muted">{feed?`Непрочитано: ${feed.unread}`:'События вашей организации'}</p></div><button className="button secondary" disabled={pending} onClick={()=>void refresh()}>Обновить</button></div>
    {error?<p className="notice error" role="alert">{error}</p>:null}
    {!feed&&!error?<p role="status">Загружаем уведомления…</p>:null}
    {feed&&!feed.items.length?<section className="panel"><h2>Пока нет уведомлений</h2><p>Здесь появятся результаты задач и события, доступные вашей роли.</p></section>:null}
    {feed?.items.map(item=><article className="panel" key={item.id}><div className="section-heading"><h2>{item.title}</h2>{!item.readAt?<span className="badge">Новое</span>:null}</div><p>{item.body}</p><p className="muted"><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ru-RU')}</time></p><div className="studio-actions"><Link className="button secondary" href={item.href}>Открыть</Link>{!item.readAt?<button className="button secondary" disabled={pending} onClick={()=>void read(item.id)}>Отметить прочитанным</button>:<span className="muted">Прочитано</span>}</div></article>)}
    {feed?.nextCursor?<button className="button secondary" disabled={pending} onClick={()=>void more()}>Показать ещё</button>:null}
  </main>;
}
