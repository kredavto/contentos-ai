'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { adminCategories, adminListSchema, adminRevokeSessionsSchema, type AdminCategory } from '@contentos/types';
import { api } from '../lib/api-client';
const labels: Record<AdminCategory, string> = { users: 'Пользователи', organizations: 'Организации', jobs: 'Задания', failed_jobs: 'Ошибки и сверка заданий', subscriptions: 'Периоды подписок', plans: 'Версии тарифов', usage: 'Учёт ресурсов', webhooks: 'Webhook-события', social: 'Социальные подключения', costs: 'Расходы AI', feature_flags: 'Флаги организаций', audit: 'Аудит', email: 'Доставка писем', payment_tasks: 'Платёжные задания', actions: 'Действия поддержки' };
const columns: Record<string, string> = { id: 'ID', userId: 'Пользователь', actorId: 'Оператор', tenantId: 'Организация', brandId: 'Бренд', email: 'Email', name: 'Название / имя', verifiedAt: 'Почта подтверждена', disabledAt: 'Отключён', createdAt: 'Дата', status: 'Статус', type: 'Тип', progress: 'Прогресс, %', provider: 'Провайдер', model: 'Модель', attempt: 'Попытка', errorCode: 'Ошибка', correlationId: 'ID запроса', startsAt: 'Начало', endsAt: 'Окончание', amountMinor: 'Цена в копейках', currency: 'Валюта', costMicrounits: 'Расход, микроединицы валюты', inputUnits: 'Входные единицы', outputUnits: 'Выходные единицы', durationMs: 'Длительность, мс', amount: 'Количество', availableDelta: 'Изменение доступного', reservedDelta: 'Изменение резерва', enabled: 'Включён', revision: 'Ревизия', version: 'Версия', ticket: 'Обращение', reason: 'Причина', revokedSessions: 'Отозвано сессий', operation: 'Операция', action: 'Событие' };
type Provider = { name: string; provider: string; model: string | null; status: string };
type Page = { rows: Array<Record<string, string | number | boolean | null>>; next: { beforeAt: string; beforeId: string } | null };
export function AdminCenter() {
  const [access, setAccess] = useState<{ role: string; configuration: Provider[] } | null>(null);
  const [page, setPage] = useState<Page | null>(null), [category, setCategory] = useState<AdminCategory>('users'), [filter, setFilter] = useState('');
  const [appliedFilter, setAppliedFilter] = useState('');
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [target, setTarget] = useState(''), [reason, setReason] = useState('USER_REQUEST'), [ticket, setTicket] = useState(''), [intent, setIntent] = useState('');
  useEffect(() => { let active = true; api<{ role: string; configuration: Provider[] }>('admin').then(async result => {
    if (!active) return; setAccess(result); const rows = await api<Page>('admin/data?category=users'); if (active) setPage(rows);
  }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  async function load(nextCategory = category, cursor?: Page['next'], value = filter) {
    setPending(true); setError('');
    const candidate = { category: nextCategory, ...(value ? nextCategory === 'users' ? { userId: value } : { tenantId: value } : {}), ...(cursor ?? {}) };
    const parsed = adminListSchema.safeParse(candidate);
    if (!parsed.success) { setError('Укажите корректный UUID для фильтра.'); setPending(false); return; }
    try { const query = new URLSearchParams(Object.entries(parsed.data).map(([key, item]) => [key, String(item)])); setPage(await api<Page>(`admin/data?${query}`)); setAppliedFilter(value); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось загрузить данные'); }
    finally { setPending(false); }
  }
  async function revoke() {
    const key = intent || crypto.randomUUID(); setIntent(key);
    const parsed = adminRevokeSessionsSchema.safeParse({ userId: target, reason, ticket, idempotencyKey: key });
    if (!parsed.success) { setError('Укажите UUID пользователя и номер обращения латиницей, цифрами, дефисом или подчёркиванием (3–80 символов).'); return; }
    if (!window.confirm('Завершить текущие сессии этого пользователя? Пользователь сможет войти снова со своим паролем.')) return;
    setPending(true); setError(''); setMessage('');
    try { const result = await api<{ revokedSessions: number }>('admin/revoke-sessions', 'POST', parsed.data); setMessage(`Отозвано сессий: ${result.revokedSessions}. Действие записано в аудит.`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось завершить сессии'); }
    finally { setPending(false); }
  }
  const filterable = !['plans', 'webhooks', 'email', 'actions'].includes(category);
  return <div className="page-container admin-center"><Link className="back-link" href="/dashboard">В рабочее пространство</Link><div className="page-eyebrow">ОПЕРАТОР ПЛАТФОРМЫ</div><h1>Администрирование</h1>
    {loading ? <p role="status">Проверяем доступ…</p> : null}{pending ? <p role="status">Выполняем запрос…</p> : null}{error ? <p className="notice error" role="alert">{error}</p> : null}{message ? <p className="saved-message" role="status">{message}</p> : null}
    {access ? <>
      <section className="panel"><h2>Конфигурация сервисов</h2><p className="muted">Наличие настроек не означает успешную проверку внешнего сервиса. Неизвестная стоимость AI сохраняется как неизвестная.</p><div className="summary-grid">{access.configuration.map(provider => <article key={provider.name}><h3>{provider.name}</h3><p>{provider.provider}{provider.model ? ` · ${provider.model}` : ''}</p><small>{provider.status === 'CONFIGURED' ? 'Настройки заданы' : provider.status === 'DISABLED' ? 'Отключён' : 'Требуется настройка'}</small></article>)}</div></section>
      <section className="panel brand-profile-editor"><h2>Операционные данные</h2><label htmlFor="admin-category">Раздел администрирования</label><select id="admin-category" value={category} disabled={pending || loading} onChange={event => { const value = event.target.value as AdminCategory; setCategory(value); setFilter(''); setPage(null); void load(value, null, ''); }}>{adminCategories.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select>
        <form className="inline-form" onSubmit={event => { event.preventDefault(); void load(); }}>{filterable ? <div><label htmlFor="admin-filter">{category === 'users' ? 'ID пользователя (необязательно)' : 'ID организации (необязательно)'}</label><input id="admin-filter" value={filter} disabled={pending || loading} onChange={event => setFilter(event.target.value)} maxLength={36} /></div> : null}<button className="button secondary" disabled={pending || loading}>Обновить с начала</button></form>
        {page && !page.rows.length ? <p className="muted">Записей по выбранному фильтру нет.</p> : null}
        {page?.rows.length ? <div className="admin-table-scroll" tabIndex={0} aria-label="Таблица операционных данных"><table><thead><tr>{Object.keys(page.rows[0]!).map(key => <th key={key}>{columns[key] ?? key}</th>)}</tr></thead><tbody>{page.rows.map(row => <tr key={String(row.id)}>{Object.entries(row).map(([key, value]) => <td key={key}>{value === null ? key === 'costMicrounits' ? 'Неизвестно' : '—' : typeof value === 'boolean' ? value ? 'Да' : 'Нет' : String(value)}</td>)}</tr>)}</tbody></table></div> : null}
        {page?.next ? <button className="button secondary" disabled={pending || loading || filter !== appliedFilter} onClick={() => void load(category, page.next)}>Следующая страница</button> : null}
      </section>
      <section className="panel brand-profile-editor"><h2>Завершить сессии пользователя</h2><p className="muted">Используйте ID пользователя и номер обращения. Пароль не меняется; новые входы остаются доступны. Для аккаунтов операторов используйте собственный выход из всех сессий.</p><form onSubmit={event => { event.preventDefault(); void revoke(); }} className="admin-support-form"><div><label htmlFor="admin-target">ID пользователя для отзыва сессий</label><input id="admin-target" required maxLength={36} value={target} disabled={pending || loading} onChange={event => { setTarget(event.target.value); setIntent(''); }} /></div><div><label htmlFor="admin-reason">Причина</label><select id="admin-reason" value={reason} disabled={pending || loading} onChange={event => { setReason(event.target.value); setIntent(''); }}><option value="USER_REQUEST">Запрос пользователя</option><option value="SECURITY_INCIDENT">Инцидент безопасности</option><option value="SUPPORT_CASE">Обращение в поддержку</option></select></div><div><label htmlFor="admin-ticket">Номер обращения</label><input id="admin-ticket" required minLength={3} maxLength={80} value={ticket} disabled={pending || loading} onChange={event => { setTicket(event.target.value); setIntent(''); }} /></div><button className="button secondary" disabled={pending || loading}>Отозвать сессии</button><button type="button" className="button secondary" disabled={pending || loading} onClick={() => { setTarget(''); setTicket(''); setIntent(''); setMessage(''); }}>Новое обращение</button></form></section>
    </> : null}
  </div>;
}
