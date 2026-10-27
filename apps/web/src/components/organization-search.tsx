'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import type {SearchPage} from '@contentos/types';
import {api} from '../lib/api-client';
import {firstSearchPage,nextSearchPage,previousSearchPage,searchPageCursor,searchPageNumber,type SearchHistory} from '../lib/search-history';
const labels={BRAND:'Бренды',IDEA:'Идеи',SCRIPT:'Сценарии',CONTENT:'Материалы',PUBLICATION:'Публикации'};
export function OrganizationSearch({tenantId}:{tenantId:string}){
  // Reset synchronously on tenant changes even when a caller omits its own key.
  return <OrganizationSearchForm key={tenantId} tenantId={tenantId}/>;
}
function OrganizationSearchForm({tenantId}:{tenantId:string}){
  const [q,setQ]=useState(''),[kind,setKind]=useState(''),[result,setResult]=useState<SearchPage|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const [submitted,setSubmitted]=useState<{q:string;kind:string}|null>(null);
  const [history,setHistory]=useState<SearchHistory>(firstSearchPage);
  const controller=useRef<AbortController|null>(null);
  const busy=useRef(false);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function load(query:{q:string;kind:string},target:SearchHistory,replace=false){
    // Ref fencing also blocks repeated clicks before React commits disabled=true.
    // A new submitted query may supersede an older request instead of joining it.
    if(busy.current&&!replace)return;
    controller.current?.abort();const request=new AbortController();controller.current=request;
    busy.current=true;setPending(true);setError('');if(replace){setResult(null);setSubmitted(query);setHistory(target);}
    try{
      const next=searchPageCursor(target);
      const params=new URLSearchParams({q:query.q,...(query.kind?{kind:query.kind}:{}),...next});
      const data=await api<SearchPage>(`organizations/${tenantId}/search?${params}`, 'GET',undefined,request.signal);
      if(controller.current===request&&!request.signal.aborted){setResult(data);setHistory(target);}
    }catch(failure){if(controller.current===request&&!request.signal.aborted)setError(failure instanceof Error?failure.message:'Не удалось выполнить поиск');}
    finally{if(controller.current===request&&!request.signal.aborted){busy.current=false;setPending(false);}}
  }
  function submit(event:FormEvent){event.preventDefault();if(q.trim().length>=2)void load({q:q.trim(),kind},firstSearchPage(),true);}
  return <section className="panel organization-search" aria-label="Поиск по организации">
    <h2>Поиск по организации</h2><p className="muted">Бренды, идеи, текущие сценарии, материалы и публикации.</p>
    <form className="inline-form" onSubmit={submit}>
      <label>Поисковый запрос<input value={q} onChange={event=>setQ(event.target.value)} required minLength={2} maxLength={120} placeholder="Название или фрагмент текста" /></label>
      <label>Тип результата<select value={kind} onChange={event=>setKind(event.target.value)}><option value="">Все типы</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <button className="button secondary" disabled={q.trim().length<2||(pending&&submitted?.q===q.trim()&&submitted.kind===kind)}>Найти</button>
    </form>
    {pending?<p role="status">Ищем…</p>:null}{error?<p role="alert" className="notice error">{error}</p>:null}
    {result?<div aria-live="polite"><p className="muted">Результаты для «{submitted?.q}»{result.next?' · есть следующая страница':''}</p>{!result.items.length?<p>Совпадений не найдено.</p>:<ul className="search-results">{result.items.map(item=><li key={`${item.kind}:${item.id}`}><small>{labels[item.kind]} · {item.brandName}</small><h3>{item.title}</h3><p>{item.excerpt}</p><Link href={item.kind==='BRAND'?`/brands/${item.brandId}/onboarding?organization=${tenantId}`:`/brands/${item.brandId}/content?organization=${tenantId}&tab=${item.kind==='IDEA'?'ideas':item.kind==='SCRIPT'?'scripts':item.kind==='PUBLICATION'?'publishing':'calendar'}`}>Открыть раздел бренда</Link></li>)}</ul>}
      <nav aria-label="Страницы результатов поиска">
        <p className="muted">Страница {searchPageNumber(history)}</p>
        {history.firstPage>1?<p className="muted">Сохранены переходы только для последних 50 страниц. Для более ранних результатов вернитесь к первой странице.</p>:null}
        {searchPageNumber(history)>1?<><button type="button" className="button secondary" disabled={pending||history.index===0} onClick={()=>submitted&&void load(submitted,previousSearchPage(history))}>Предыдущая страница результатов</button>{' '}<button type="button" className="button secondary" disabled={pending} onClick={()=>submitted&&void load(submitted,firstSearchPage())}>Первая страница результатов</button>{' '}</>:null}
        {result.next?<button type="button" className="button secondary" disabled={pending} onClick={()=>submitted&&result.next&&void load(submitted,nextSearchPage(history,result.next))}>Следующая страница результатов</button>:null}
      </nav>
    </div>:null}
  </section>;
}
