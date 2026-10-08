'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api-client';
type Order = { id:string;planVersionId:string;amountMinor:number;currency:string;createdAt:string;status:string;confirmationUrl:string|null;errorCode:string|null };
type PurchasePreview = {target:{id:string;name:string;amountMinor:number;aiCredits:number;videoSeconds:number};source:{name:string}|null;expectedTermId:string|null;direction:string;effectiveAt:string|null};
type RenewalPolicy = {planVersionId:string;policyVersion:string;text:string;textHash:string;expectedRevision:number;purchase?:PurchasePreview};
type Overview = { renewalEngineReady?:boolean;checkoutStatus:'READY'|'CONFIGURATION_REQUIRED';plans:Array<{planVersionId:string;code:string;name:string;amountMinor:number;currency:string;aiCredits:number;videoSeconds:number}>;subscription:{status:string;current:{endsAt:string;planName?:string}|null;upcoming?:Array<{orderId:string;startsAt:string;endsAt:string;planName?:string}>;orders:Array<Omit<Order,'status'|'confirmationUrl'|'errorCode'>>};renewal:{planMatches?:boolean;methodReady?:boolean;nextPaymentAt?:string|null;revision:number;active:{policyText:string}|null} };
const money=(value:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(value/100);
const labels:Record<string,string>={QUEUED:'Готовим оплату',RUNNING:'Проверяем платёж',WAITING:'Ожидаем оплату',PAID:'Оплачено',FAILED:'Оплата не прошла',CANCELED:'Отменено',RECONCILIATION:'Требуется проверка платежа'};
export function BillingStudio({tenantId}:{tenantId:string}){
  const base=`organizations/${tenantId}/billing`;
  const [data,setData]=useState<Overview|null>(null),[order,setOrder]=useState<Order|null>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
  const intent=useRef<{planVersionId:string;idempotencyKey:string;expectedTermId?:string}|null>(null);
  const [purchase,setPurchase]=useState<PurchasePreview|null>(null);
  const [policy,setPolicy]=useState<RenewalPolicy|null>(null),[accepted,setAccepted]=useState(false),[renewalAttempted,setRenewalAttempted]=useState(false);
  const renewalIntent=useRef<{acceptKey:string;checkoutKey:string;permission?:{consentId:string;revision:number}}|null>(null);
  const load=useCallback(async()=>{const next=await api<Overview>(base);setData(next);return next;},[base]);
  useEffect(()=>{let active=true;api<Overview>(base).then(async value=>{const latest=value.subscription.orders[0];const existing=latest?await api<Order>(`${base}/orders/${latest.id}`):null;if(active){setData(value);setOrder(existing);}}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить биллинг');});return()=>{active=false;};},[base]);
  useEffect(()=>{
    if(!order||!['QUEUED','RUNNING','WAITING'].includes(order.status))return;
    let active=true;const timer=setInterval(()=>{void api<Order>(`${base}/orders/${order.id}`).then(value=>{if(active){setOrder(value);if(value.status==='PAID')void load().catch(failure=>setError(failure instanceof Error?failure.message:'Не удалось обновить подписку'));}}).catch(failure=>{if(active)setError(failure instanceof Error?failure.message:'Не удалось проверить платёж');});},4000);
    return()=>{active=false;clearInterval(timer);};
  },[base,order?.id,order?.status,load]);
  async function checkout(planVersionId:string,confirmed?:PurchasePreview){
    if(pending)return;setPending(true);setError('');
    try{
      if(order&&['PAID','FAILED','CANCELED'].includes(order.status))intent.current=null;
      if(!intent.current||intent.current.planVersionId!==planVersionId){
        const preview=confirmed??await api<PurchasePreview>(`${base}/purchase-preview/${planVersionId}`);
        if(preview.expectedTermId&&!confirmed){setPurchase(preview);return;}
        intent.current={planVersionId,idempotencyKey:crypto.randomUUID(),...(preview.expectedTermId?{expectedTermId:preview.expectedTermId}:{})};
      }
      setPurchase(null);setOrder(null);
      const result=await api<Order>(`${base}/checkout`,'POST',intent.current);setOrder(result);await load();
    }catch(failure){setError(failure instanceof Error?failure.message:'Не удалось создать заказ');}finally{setPending(false);}
  }

  async function inspect(id:string){setPending(true);setError('');try{const result=await api<Order>(`${base}/orders/${id}`);setOrder(result);if(result.status==='PAID')await load();}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось загрузить заказ');}finally{setPending(false);}}
  async function previewRenewal(planVersionId:string){
    if(pending)return;setPending(true);setError('');
    try{const value=await api<RenewalPolicy>(`${base}/renewal-policy/${planVersionId}`);setPolicy(value);setAccepted(false);setRenewalAttempted(false);renewalIntent.current={acceptKey:crypto.randomUUID(),checkoutKey:crypto.randomUUID()};}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось загрузить условия');}finally{setPending(false);}
  }
  async function savingCheckout(){
    if(pending||!policy||!accepted||!renewalIntent.current)return;
    setPending(true);setError('');setRenewalAttempted(true);
    const current=renewalIntent.current;
    try{
      if(!current.permission)current.permission=await api(`${base}/accept-renewal`,'POST',{planVersionId:policy.planVersionId,policyVersion:policy.policyVersion,textHash:policy.textHash,expectedRevision:policy.expectedRevision,accepted:true,idempotencyKey:current.acceptKey});
      const result=await api<Order>(`${base}/checkout`,'POST',{planVersionId:policy.planVersionId,idempotencyKey:current.checkoutKey,renewal:current.permission,...(policy.purchase?.expectedTermId?{expectedTermId:policy.purchase.expectedTermId}:{})});
      setOrder(result);setPolicy(null);intent.current=null;await load();
    }catch(failure){setError(failure instanceof Error?failure.message:'Не удалось подготовить оплату');}finally{setPending(false);}
  }
  async function cancel(){if(!data)return;setPending(true);setError('');try{await api(`${base}/cancel-renewal`,'POST',{expectedRevision:data.renewal.revision,idempotencyKey:crypto.randomUUID()});await load();}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось отключить продление');}finally{setPending(false);}}
  return <main className="workspace-main content-studio billing-studio">
    <Link href="/dashboard" className="back-link">← Рабочее пространство</Link>
    <div className="page-title"><div><div className="page-eyebrow">ТАРИФ И РЕСУРСЫ</div><h1>Биллинг</h1><p className="muted">Оплаченный период и ресурсы вашей организации.</p></div></div>
    {error?<p className="notice error" role="alert">{error}</p>:null}
    {!data?<section className="panel" role="status">{error?'Биллинг недоступен для этого аккаунта.':'Загружаем тарифы…'}</section>:<>
      <section className="panel"><h2>{data.subscription.current?`Подписка активна${data.subscription.current.planName?` · ${data.subscription.current.planName}`:''}`:'Нет оплаченного периода'}</h2>{data.subscription.current?<p>Текущий период до {new Date(data.subscription.current.endsAt).toLocaleDateString('ru-RU')}. Следующая покупка добавит месяц после текущего оплаченного периода.</p>:<p>Выберите тариф для доступа на один месяц.</p>}{data.subscription.upcoming?.map(term=><p key={term.orderId}>Следующий оплаченный период{term.planName?` · ${term.planName}`:''}: {new Date(term.startsAt).toLocaleDateString('ru-RU')} — {new Date(term.endsAt).toLocaleDateString('ru-RU')}.</p>)}<p className="muted">Ресурсы начисляются после подтверждения оплаты. Обычная покупка не включает автопродление.</p></section>
      {data.checkoutStatus!=='READY'?<p className="notice warning">Приём платежей пока не подключён. Покупка станет доступна после настройки оплаты и чеков.</p>:null}
      {order?<section className="panel" aria-live="polite"><h2>{labels[order.status]??'Проверяем заказ'}</h2><p>{money(order.amountMinor)}</p>{order.confirmationUrl?<a className="button primary" href={order.confirmationUrl} rel="noreferrer">Перейти к оплате</a>:null}{order.status==='RECONCILIATION'?<p>Не создавайте новый платёж. Результат должен быть проверен администратором.</p>:null}<button className="text-button" disabled={pending} onClick={()=>void inspect(order.id)}>Обновить статус</button></section>:null}
      <div className="plan-grid">{data.plans.map(plan=><section className="panel" key={plan.planVersionId}><span className="badge">{plan.code}</span><h2>{plan.name}</h2><h3>{money(plan.amountMinor)} / месяц</h3><p>{plan.aiCredits.toLocaleString('ru-RU')} AI-кредитов · {plan.videoSeconds.toLocaleString('ru-RU')} видеосекунд</p><button className="button primary" disabled={pending||Boolean(policy||purchase)||data.checkoutStatus!=='READY'||Boolean(intent.current&&!order&&intent.current.planVersionId!==plan.planVersionId)||Boolean(order&&!['PAID','FAILED','CANCELED'].includes(order.status))} onClick={()=>void checkout(plan.planVersionId)}>Оплатить месяц</button>{data.renewalEngineReady?<button className="button secondary" disabled={pending||Boolean(policy||purchase)||Boolean(intent.current&&!order)||Boolean(order&&!['PAID','FAILED','CANCELED'].includes(order.status))} onClick={()=>void previewRenewal(plan.planVersionId)}>Оплатить с автопродлением</button>:null}</section>)}</div>
      {purchase?<section className="panel" aria-labelledby="plan-change-title"><h2 id="plan-change-title">{purchase.direction==='UPGRADE'?'Повышение тарифа':'Понижение тарифа'}</h2><p>{purchase.source?.name} → {purchase.target.name}</p><p>Стоимость следующего месяца: {money(purchase.target.amountMinor)}. Начало после оплаченных периодов: {purchase.effectiveAt?new Date(purchase.effectiveAt).toLocaleString('ru-RU'):'после оплаты'}.</p><p>Текущий тариф и оплаченный срок сохраняются. Ресурсы нового месяца начисляются после оплаты. Если до подтверждения будет оплачен другой заказ, дата перехода сдвинется после него. Автопродление на другой тариф требует отдельного согласия.</p><div className="studio-actions"><button className="button primary" disabled={pending} onClick={()=>void checkout(purchase.target.id,purchase)}>Подтвердить смену тарифа</button><button className="button secondary" disabled={pending} onClick={()=>setPurchase(null)}>Назад</button></div></section>:null}
      {policy?<section className="panel" aria-labelledby="renewal-policy-title"><h2 id="renewal-policy-title">Ежемесячное автопродление</h2><p className="preserve-lines" id="renewal-policy-text">{policy.text}</p>{policy.purchase?.effectiveAt?<p>Новый оплаченный месяц начнётся после уже оплаченных периодов: {new Date(policy.purchase.effectiveAt).toLocaleString('ru-RU')}. Текущий период сохраняется.</p>:null}<p>Способ оплаты сохраняет платёжный провайдер после успешной оплаты. Дату следующего списания покажем здесь. Новое согласие заменит прежнее автопродление.</p><label className="consent-checkbox"><input type="checkbox" checked={accepted} disabled={pending||renewalAttempted} onChange={event=>setAccepted(event.target.checked)} aria-describedby="renewal-policy-text" /> Согласен с условиями сохранения способа оплаты и ежемесячного списания</label><div className="studio-actions"><button className="button primary" disabled={pending||!accepted} onClick={()=>void savingCheckout()}>{renewalAttempted?'Повторить подготовку оплаты':'Подтвердить и подготовить оплату'}</button>{!renewalAttempted?<button className="button secondary" disabled={pending} onClick={()=>setPolicy(null)}>Назад</button>:null}</div>{renewalAttempted?<p className="muted">При ошибке повторите подготовку: сохранится тот же заказ. Подтверждение оплаты может потребоваться на странице провайдера.</p>:null}</section>:null}
      {!data.plans.length?<section className="panel"><h2>Тарифы ещё не опубликованы</h2><p className="muted">Администратор добавит цены и лимиты ресурсов.</p></section>:null}
      <section className="panel"><h2>Автопродление</h2>{data.renewal.active?<><p>{!data.renewalEngineReady?'Согласие сохранено. Автоматическое списание ещё не подключено.':data.renewal.methodReady&&data.renewal.planMatches===false?'Согласие относится к другому тарифу. Для нового тарифа нужно отдельное согласие на автопродление.':data.renewal.methodReady?'Способ оплаты сохранён для автопродления.':'Согласие сохранено. Способ оплаты ещё не готов: завершите оплату и обновите статус.'}</p><p className="preserve-lines">{data.renewal.active.policyText}</p>{data.renewal.nextPaymentAt?<p>Следующее списание: {new Date(data.renewal.nextPaymentAt).toLocaleString('ru-RU')}.</p>:null}<button className="button secondary" disabled={pending||Boolean(policy||purchase)} onClick={()=>void cancel()}>Отключить продление</button></>:<p>Не включено. Покупки требуют вашего подтверждения.</p>}</section>
      <section className="panel"><h2>Последние заказы</h2>{data.subscription.orders.length?data.subscription.orders.map(item=><div className="section-heading" key={item.id}><span>{new Date(item.createdAt).toLocaleString('ru-RU')} · {money(item.amountMinor)}</span><button className="text-button" disabled={pending} onClick={()=>void inspect(item.id)}>Проверить статус</button></div>):<p className="muted">Покупок пока нет.</p>}</section>
    </>}
  </main>;
}
