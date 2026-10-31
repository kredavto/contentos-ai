'use client';
import {useRef,useState} from 'react';
import type {PublicationAnalyticsService} from '@contentos/core';
import {api} from '../lib/api-client';
export type PublicationAnalyticsOverview=Awaited<ReturnType<PublicationAnalyticsService['overview']>>;
export function PublicationAnalytics({base,publicationId,canManage,data,onRequested}:{base:string;publicationId:string;canManage:boolean;data:PublicationAnalyticsOverview|null;onRequested:()=>void}){
  const [error,setError]=useState(''),[pending,setPending]=useState(false);
  const intent=useRef<string|null>(null);
  async function request(){setPending(true);setError('');intent.current??=crypto.randomUUID();try{
    await api(`${base}/publication-analytics`,'POST',{publicationId,idempotencyKey:intent.current});intent.current=null;onRequested();
  }catch(failure){setError(failure instanceof Error?failure.message:'Не удалось запросить метрики');}finally{setPending(false);}}
  const job=data?.jobs.find(row=>row.publicationId===publicationId),busy=!!job&&['QUEUED','RUNNING'].includes(job.status);
  const labels={QUEUED:'В очереди',RUNNING:'Получаем показатели',SUCCEEDED:'Показатели сохранены',FAILED:'Не удалось получить показатели',CANCELLED:'Обновление остановлено: проверьте доступ к видео и подключение канала'};
  return <div className="stack">{data?.configuration.source==='DEMO'?<p className="notice warning">ДЕМО: показатели имитируются. Google API не вызывается.</p>:null}{canManage?<button className="button secondary" disabled={!data?.configuration.ready||pending||busy} onClick={()=>void request()}>Получить метрики YouTube</button>:null}
    {data&&!data.configuration.ready?<p className="muted">Для получения метрик требуется настроенное подключение YouTube.</p>:null}
    {job?<p role="status">{labels[job.status]}{job.status==='QUEUED'&&job.attempt>0?' · повторная попытка запланирована':''}</p>:null}
    {error?<p role="alert">{error}</p>:null}
  </div>;
}
