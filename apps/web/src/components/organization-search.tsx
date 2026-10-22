'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import type {SearchPage} from '@contentos/types';
import {api} from '../lib/api-client';
const labels={BRAND:'Бренды',IDEA:'Идеи',SCRIPT:'Сценарии',CONTENT:'Материалы',PUBLICATION:'Публикации'};
export function OrganizationSearch({tenantId}:{tenantId:string}){
  const [q,setQ]=useState(''),[kind,setKind]=useState(''),[result,setResult]=useState<SearchPage|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const [submitted,setSubmitted]=useState<{q:string;kind:string}|null>(null);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function load(query:{q:string;kind:string},next:SearchPage['next']=null){
    controller.current?.abort();const request=new AbortController();controller.current=request;
    setPending(true);setError('');if(!next){setResult(null);setSubmitted(query);}
    try{
      const params=new URLSearchParams({q:query.q,...(query.kind?{kind:query.kind}:{}),...next});
      const data=await api<SearchPage>(`organizations/${tenantId}/search?${params}`, 'GET',undefined,request.signal);
      if(!request.signal.aborted)setResult(data);
    }catch(failure){if(!request.signal.aborted)setError(failure instanceof Error?failure.message:'Не удалось выполнить поиск');}
    finally{if(!request.signal.aborted)setPending(false);}
  }
  function submit(event:FormEvent){event.preventDefault();void load({q:q.trim(),kind});}
  return <section className="panel organization-search" aria-label="Поиск по организации">
    <h2>Поиск по организации</h2><p className="muted">Бренды, идеи, текущие сценарии, материалы и публикации.</p>
    <form className="inline-form" onSubmit={submit}>
      <label>Поисковый запрос<input value={q} onChange={event=>setQ(event.target.value)} required minLength={2} maxLength={120} placeholder="Название или фрагмент текста" /></label>
      <label>Тип результата<select value={kind} onChange={event=>setKind(event.target.value)}><option value="">Все типы</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <button className="button secondary" disabled={pending||q.trim().length<2}>Найти</button>
    </form>
    {pending?<p role="status">Ищем…</p>:null}{error?<p role="alert" className="notice error">{error}</p>:null}
    {result?<div aria-live="polite"><p className="muted">Результаты для «{submitted?.q}»{result.next?' · есть следующая страница':''}</p>{!result.items.length?<p>Совпадений не найдено.</p>:<ul className="search-results">{result.items.map(item=><li key={`${item.kind}:${item.id}`}><small>{labels[item.kind]} · {item.brandName}</small><h3>{item.title}</h3><p>{item.excerpt}</p><Link href={item.kind==='BRAND'?`/brands/${item.brandId}/onboarding?organization=${tenantId}`:`/brands/${item.brandId}/content?organization=${tenantId}&tab=${item.kind==='IDEA'?'ideas':item.kind==='SCRIPT'?'scripts':item.kind==='PUBLICATION'?'publishing':'calendar'}`}>Открыть раздел бренда</Link></li>)}</ul>}
      {result.next?<button className="button secondary" disabled={pending} onClick={()=>submitted&&void load(submitted,result.next)}>Следующая страница результатов</button>:null}
    </div>:null}
  </section>;
}
