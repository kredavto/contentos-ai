'use client';
import { useState } from 'react';
import { adminFinanceSchema, type AdminFinanceReport } from '@contentos/types';
import { api } from '../lib/api-client';
function money(value: string, places: number) { const padded = value.padStart(places + 1, '0'); return `${BigInt(padded.slice(0, -places)).toLocaleString('ru-RU')},${padded.slice(-places)}`; }
export function AdminFinance() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [tenant, setTenant] = useState(''), [mode, setMode] = useState('LIVE'), [group, setGroup] = useState('BRAND');
  const [report, setReport] = useState<AdminFinanceReport | null>(null), [scope, setScope] = useState(''), [pending, setPending] = useState(false), [error, setError] = useState('');
  async function load() {
    const parsed = adminFinanceSchema.safeParse({ from: `${from}T00:00:00Z`, to: `${to}T00:00:00Z`, paymentMode: mode, groupBy: group, ...(tenant ? { tenantId: tenant } : {}) });
    if (!parsed.success) { setError('Выберите период до 93 дней, окончание позже начала и корректный UUID организации.'); return; }
    setPending(true); setError(''); setReport(null);
    try { const query = new URLSearchParams(Object.entries(parsed.data)); setReport(await api<AdminFinanceReport>(`admin/finance?${query}`)); setScope(`${from} — ${to} (конец не включён), UTC · ${mode === 'LIVE' ? 'боевые платежи' : 'тестовые платежи'} · ${tenant || 'все организации'} · ${group === 'USER' ? 'по пользователю' : group === 'BRAND' ? 'по бренду' : 'по провайдеру'}`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось загрузить сводку'); }
    finally { setPending(false); }
  }
  return <section className="panel brand-profile-editor"><h2>Финансовые данные</h2><p className="muted">Поступления показаны по дате подтверждения в системе, без вычета возвратов, налогов и комиссий. Расходы — только записанные AI-вызовы по дате начала вызова, включая все попытки. Валюты не пересчитываются. Выбор боевых или тестовых платежей не фильтрует AI-вызовы.</p>
    <form className="admin-support-form" onSubmit={event => { event.preventDefault(); void load(); }}><fieldset disabled={pending}>
      <div><label htmlFor="finance-from">Начало периода, UTC</label><input id="finance-from" type="date" required value={from} onChange={event => setFrom(event.target.value)} /></div>
      <div><label htmlFor="finance-to">Конец периода, UTC (не включён)</label><input id="finance-to" type="date" required value={to} onChange={event => setTo(event.target.value)} /></div>
      <div><label htmlFor="finance-tenant">Организация для финансовой сводки (UUID)</label><input id="finance-tenant" maxLength={36} value={tenant} onChange={event => setTenant(event.target.value)} /></div>
      <div><label htmlFor="finance-mode">Режим платежей</label><select id="finance-mode" value={mode} onChange={event => setMode(event.target.value)}><option value="LIVE">Боевые</option><option value="TEST">Тестовые</option></select></div>
      <div><label htmlFor="finance-group">Группировка расходов</label><select id="finance-group" value={group} onChange={event => setGroup(event.target.value)}><option value="BRAND">По бренду</option><option value="USER">По пользователю</option><option value="PROVIDER">По провайдеру</option></select></div>
      <button className="button secondary">Рассчитать сводку</button></fieldset></form>
    {pending ? <p role="status">Рассчитываем финансовые данные…</p> : null}{error ? <p className="notice error" role="alert">{error}</p> : null}
    {report ? <div><p className="muted">{scope}</p><h3>Подтверждённые поступления</h3>{report.revenue.length ? report.revenue.map(row => <p key={row.currency}>{money(row.amountMinor, 2)} {row.currency} · платежей: {row.payments}</p>) : <p>Подтверждённых платежей за выбранный период нет.</p>}
      <h3>Известные расходы AI</h3>{report.costs.length ? report.costs.map(row => <p key={row.currency}>{money(row.knownMicrounits, 6)} {row.currency} · вызовов: {row.calls} · без известной стоимости: {row.unknownCalls}</p>) : <p>AI-вызовов за выбранный период нет.</p>}
      <h3>Валовая маржа</h3><p>Не рассчитана: учёт расходов провайдеров, видео, возвратов и комиссий ещё неполон. Известные расходы не равны полной себестоимости.</p>
      <p>Заданий, созданных за период, без денежной оценки: {report.jobsWithoutCostEvidence}; из них видеозаданий: {report.videoJobsWithoutCostEvidence}. Это не число оплаченных вызовов; оценка наличия стоимости учитывает всю историю задания.</p>
      <h3>Списанные пользовательские ресурсы</h3>{report.captured.length ? report.captured.map(row => <p key={row.unit}>{row.unit === 'AI_CREDITS' ? 'AI-кредиты' : 'Секунды видео'}: {row.amount}</p>) : <p>Списаний за период нет.</p>}<p className="muted">Резервы и освобождения не считаются списаниями. Пользовательские ресурсы не конвертируются в деньги.</p>
      {report.groups.length ? <div className="admin-table-scroll" tabIndex={0} aria-label="Расходы по выбранной группировке"><table><thead><tr><th>ID / провайдер</th><th>Валюта</th><th>Известные расходы</th><th>Вызовов</th><th>Без стоимости</th></tr></thead><tbody>{report.groups.map(row => <tr key={`${row.entityId}:${row.currency}`}><td>{row.entityId}</td><td>{row.currency}</td><td>{money(row.knownMicrounits, 6)}</td><td>{row.calls}</td><td>{row.unknownCalls}</td></tr>)}</tbody></table></div> : null}
      {report.groupsTruncated ? <p>Показаны первые 50 групп по числу вызовов. Уменьшите период или выберите организацию. Итоговые суммы выше включают все группы.</p> : null}
    </div> : null}
  </section>;
}
