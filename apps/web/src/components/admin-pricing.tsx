'use client';
import { useEffect, useState } from 'react';
import { adminPlanCodes, adminPlanSchema, type AdminPlan } from '@contentos/types';
import { api } from '../lib/api-client';
type Catalog = { role: string; plans: AdminPlan[] };
export function AdminPricing() {
  const [catalog, setCatalog] = useState<Catalog | null>(null), [draft, setDraft] = useState<AdminPlan | null>(null);
  const [ticket, setTicket] = useState(''), [intent, setIntent] = useState(''), [pending, setPending] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [dirty, setDirty] = useState(false);
  useEffect(() => { let active = true; api<Catalog>('admin/plans').then(result => { if (active) { setCatalog(result); setDraft(result.plans.find(plan => plan.code === 'START') ?? result.plans[0] ?? null); } }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, []);
  async function refresh() {
    if (dirty && !window.confirm('Загрузить действующие тарифы и сбросить несохранённые поля?')) return;
    setPending(true); setError('');
    try { const result = await api<Catalog>('admin/plans'); setCatalog(result); setDraft(result.plans.find(plan => plan.code === draft?.code) ?? result.plans[0] ?? null); setDirty(false); setIntent(''); setTicket(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось загрузить тарифы'); }
    finally { setPending(false); }
  }
  function edit(values: Partial<AdminPlan>) { if (draft) setDraft({ ...draft, ...values }); setDirty(true); setIntent(''); setMessage(''); }
  async function publish() {
    if (!draft) return;
    const key = intent || crypto.randomUUID(); setIntent(key);
    const parsed = adminPlanSchema.safeParse({ code: draft.code, name: draft.name, enabled: draft.enabled, expectedVersion: draft.version, amountMinor: draft.amountMinor, currency: draft.currency, aiCredits: draft.aiCredits, videoSeconds: draft.videoSeconds, ticket, idempotencyKey: key });
    if (!parsed.success) { setError('Проверьте поля: целые неотрицательные лимиты, положительная цена платного тарифа (FREE — 0), номер изменения 3–80 символов латиницей, цифрами, дефисом или подчёркиванием.'); return; }
    if (!window.confirm(`Опубликовать ${draft.code}, версию ${draft.version + 1}: ${(draft.amountMinor / 100).toFixed(2)} ₽/месяц, ${draft.aiCredits} AI-кредитов, ${draft.videoSeconds} секунд видео? Тариф будет ${draft.enabled ? 'доступен' : 'отключён для новых покупок и планирования автопродлений'}.`)) return;
    setPending(true); setError(''); setMessage('');
    try {
      await api('admin/plans', 'POST', parsed.data);
      setMessage('Версия тарифа опубликована. Оплаченные заказы и действующие периоды сохранены.');
      // Keep the exact intent on a read failure; retry is safe after an uncertain response.
      const result = await api<Catalog>('admin/plans'); setCatalog(result); setDraft(result.plans.find(plan => plan.code === draft.code) ?? null); setDirty(false); setIntent(''); setTicket('');
    } catch (failure) { setError(`${failure instanceof Error ? failure.message : 'Не удалось сохранить тариф'}. Повторите запрос с теми же полями или загрузите действующие тарифы.`); }
    finally { setPending(false); }
  }
  return <section className="panel brand-profile-editor"><h2>Управление тарифами</h2><p className="muted">Каждое сохранение создаёт новую версию, в том числе при включении и отключении. Цена — за месяц в копейках, видео — в секундах. Автопродление сохраняет условия принятого согласия; новые условия требуют нового согласия. Отключение тарифа также останавливает планирование новых автопродлений. FREE не оформляется через платёжный checkout.</p>
    {error ? <p role="alert" className="notice error">{error}</p> : null}{message ? <p role="status" className="saved-message">{message}</p> : null}
    <button type="button" className="button secondary" disabled={pending} onClick={() => void refresh()}>Загрузить действующие тарифы</button>
    {catalog && draft ? <form className="admin-support-form" onSubmit={event => { event.preventDefault(); void publish(); }}>
      <div><label htmlFor="pricing-code">Тариф</label><select id="pricing-code" value={draft.code} disabled={pending} onChange={event => { if (dirty && !window.confirm('Сбросить несохранённые изменения тарифа?')) return; setDraft(catalog.plans.find(plan => plan.code === event.target.value) ?? null); setDirty(false); setIntent(''); setTicket(''); setError(''); setMessage(''); }}>{adminPlanCodes.map(code => <option key={code} value={code}>{code}</option>)}</select></div>
      <p>Текущая версия: {draft.version || 'не создана'}</p>
      <fieldset disabled={pending || catalog.role !== 'ADMIN'}><div><label htmlFor="pricing-name">Название тарифа</label><input id="pricing-name" required maxLength={80} value={draft.name} onChange={event => edit({ name: event.target.value })} /></div>
        {([['amountMinor', 'Цена за месяц, копейки'], ['aiCredits', 'AI-кредиты за месяц'], ['videoSeconds', 'Видео за месяц, секунды']] as const).map(([field, label]) => <div key={field}><label htmlFor={`pricing-${field}`}>{label}</label><input id={`pricing-${field}`} type="number" required min={0} max={1000000000} step={1} value={Number.isFinite(draft[field]) ? draft[field] : ''} onChange={event => edit({ [field]: event.target.valueAsNumber })} /></div>)}
        <label><input type="checkbox" checked={draft.enabled} onChange={event => edit({ enabled: event.target.checked })} /> Доступен в каталоге</label>
        <div><label htmlFor="pricing-ticket">Номер изменения тарифа</label><input id="pricing-ticket" required minLength={3} maxLength={80} value={ticket} onChange={event => { setTicket(event.target.value); setIntent(''); }} /></div>
        <button className="button secondary" disabled={!dirty}>Опубликовать версию тарифа</button>
      </fieldset>{catalog.role !== 'ADMIN' ? <p className="muted">SUPPORT может просматривать тарифы. Для изменений нужна роль ADMIN.</p> : null}
    </form> : <p className="muted">Каталог ещё не загружен.</p>}
  </section>;
}
