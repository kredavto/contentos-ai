'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api-client';
type Order = { id:string;planVersionId:string;amountMinor:number;currency:string;createdAt:string;status:string;confirmationUrl:string|null;errorCode:string|null };
type Overview = { renewalEngineReady?:boolean;checkoutStatus:'READY'|'CONFIGURATION_REQUIRED';plans:Array<{planVersionId:string;code:string;name:string;amountMinor:number;currency:string;aiCredits:number;videoSeconds:number}>;subscription:{status:string;current:{endsAt:string}|null;upcoming?:Array<{orderId:string;startsAt:string;endsAt:string}>;orders:Array<Omit<Order,'status'|'confirmationUrl'|'errorCode'>>};renewal:{revision:number;active:{policyText:string}|null} };
const money=(value:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(value/100);
const labels:Record<string,string>={QUEUED:'Готовим оплату',RUNNING:'Проверяем платёж',WAITING:'Ожидаем оплату',PAID:'Оплачено',FAILED:'Оплата не прошла',CANCELED:'Отменено',RECONCILIATION:'Требуется проверка платежа'};
export function BillingStudio({tenantId}:{tenantId:string}){
  const base=`organizations/${tenantId}/billing`;
  const [data,setData]=useState<Overview|null>(null),[order,setOrder]=useState<Order|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const intent=useRef<{planVersionId:string;idempotencyKey:string}|null>(null);
  const load=useCallback(async()=>{const next=await api<Overview>(base);setData(next);return next;},[base]);
  useEffect(()=>{let active=true;api<Overview>(base).then(async value=>{const latest=value.subscription.orders[0];const existing=latest?await api<Order>(`${base}/orders/${latest.id}`):null;if(active){setData(value);setOrder(existing);}}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить биллинг');});return()=>{active=false;};},[base]);
  useEffect(()=>{
    if(!order||!['QUEUED','RUNNING','WAITING'].includes(order.status))return;
    let active=true;const timer=setInterval(()=>{void api<Order>(`${base}/orders/${order.id}`).then(value=>{if(active){setOrder(value);if(value.status==='PAID')void load().catch(failure=>setError(failure instanceof Error?failure.message:'Не удалось обновить подписку'));}}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Не удалось проверить платёж');});},4000);
    return()=>{active=false;clearInterval(timer);};
  },[base,order?.id,order?.status,load]);
  async function checkout(planVersionId:string){
    if(pending)return;setPending(true);setError('');
    if(order&&['PAID','FAILED','CANCELED'].includes(order.status))intent.current=null;
    if(!intent.current||intent.current.planVersionId!==planVersionId)intent.current={planVersionId,idempotencyKey:crypto.randomUUID()};
    setOrder(null);
    try{const result=await api<Order>(`${base}/checkout`,'POST',intent.current);setOrder(result);await load();}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось создать заказ');}finally{setPending(false);}
  }
  async function inspect(id:string){setPending(true);setError('');try{const result=await api<Order>(`${base}/orders/${id}`);setOrder(result);if(result.status==='PAID')await load();}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось загрузить заказ');}finally{setPending(false);}}
  async function cancel(){if(!data)return;setPending(true);setError('');try{await api(`${base}/cancel-renewal`,'POST',{expectedRevision:data.renewal.revision,idempotencyKey:crypto.randomUUID()});await load();}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось отключить продление');}finally{setPending(false);}}
  return <main className="workspace-main content-studio">
    <Link href="/dashboard" className="back-link">← Рабочее пространство</Link>
    <div className="page-title"><div><div className="page-eyebrow">ТАРИФ И РЕСУРСЫ</div><h1>Биллинг</h1><p className="muted">Оплаченный период и ресурсы вашей организации.</p></div></div>
    {error?<p className="notice error" role="alert">{error}</p>:null}
    {!data?<section className="panel" role="status">{error?'Биллинг недоступен для этого аккаунта.':'Загружаем тарифы…'}</section>:<>
      <section className="panel"><h2>{data.subscription.current?'Подписка активна':'Нет оплаченного периода'}</h2>{data.subscription.current?<p>Текущий период до {new Date(data.subscription.current.endsAt).toLocaleDateString('ru-RU')}. Следующая покупка добавит месяц после текущего оплаченного периода.</p>:<p>Выберите тариф для доступа на один месяц.</p>}{data.subscription.upcoming?.map(term=><p key={term.orderId}>Следующий оплаченный период: {new Date(term.startsAt).toLocaleDateString('ru-RU')} — {new Date(term.endsAt).toLocaleDateString('ru-RU')}.</p>)}<p className="muted">Ресурсы начисляются после подтверждения оплаты. Эта покупка не включает автопродление.</p></section>
      {data.checkoutStatus!=='READY'?<p className="notice warning">Приём платежей пока не подключён. Покупка станет доступна после настройки оплаты и чеков.</p>:null}
      {order?<section className="panel" aria-live="polite"><h2>{labels[order.status]??'Проверяем заказ'}</h2><p>{money(order.amountMinor)}</p>{order.confirmationUrl?<a className="button primary" href={order.confirmationUrl} rel="noreferrer">Перейти к оплате</a>:null}{order.status==='RECONCILIATION'?<p>Не создавайте новый платёж. Результат должен быть проверен администратором.</p>:null}<button className="text-button" disabled={pending} onClick={()=>void inspect(order.id)}>Обновить статус</button></section>:null}
      <div className="plan-grid">{data.plans.map(plan=><section className="panel" key={plan.planVersionId}><span className="badge">{plan.code}</span><h2>{plan.name}</h2><h3>{money(plan.amountMinor)} / месяц</h3><p>{plan.aiCredits.toLocaleString('ru-RU')} AI-кредитов · {plan.videoSeconds.toLocaleString('ru-RU')} видеосекунд</p><button className="button primary" disabled={pending||data.checkoutStatus!=='READY'||Boolean(intent.current&&!order&&intent.current.planVersionId!==plan.planVersionId)||Boolean(order&&!['PAID','FAILED','CANCELED'].includes(order.status))} onClick={()=>void checkout(plan.planVersionId)}>Оплатить месяц</button></section>)}</div>
      {!data.plans.length?<section className="panel"><h2>Тарифы ещё не опубликованы</h2><p className="muted">Администратор добавит цены и лимиты ресурсов.</p></section>:null}
      <section className="panel"><h2>Автопродление</h2>{data.renewal.active?<><p>{data.renewalEngineReady?'Согласие сохранено. Продление выполняется при наличии действующего способа оплаты.':'Согласие сохранено. Автоматическое списание ещё не подключено.'}</p><p className="preserve-lines">{data.renewal.active.policyText}</p><button className="button secondary" disabled={pending} onClick={()=>void cancel()}>Отключить продление</button></>:<p>Не включено. Покупки требуют вашего подтверждения.</p>}</section>
      <section className="panel"><h2>Последние заказы</h2>{data.subscription.orders.length?data.subscription.orders.map(item=><div className="section-heading" key={item.id}><span>{new Date(item.createdAt).toLocaleString('ru-RU')} · {money(item.amountMinor)}</span><button className="text-button" disabled={pending} onClick={()=>void inspect(item.id)}>Проверить статус</button></div>):<p className="muted">Покупок пока нет.</p>}</section>
    </>}
  </main>;
}
