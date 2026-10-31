'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api-client';
type Client = { id: string; organizationId: string; name: string; role: string; revision: string; archivedAt: string | null };
type Overview = { enabled: boolean; revision: number; role: string; clients: Client[] };
type Organization = { id: string; name: string; role: string };
export function AgencyCenter({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Overview | null>(null), [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [name, setName] = useState(''), [existingId, setExistingId] = useState('');
  const [createKey, setCreateKey] = useState(''), [linkKey, setLinkKey] = useState('');
  const load = useCallback(async () => {
    const [overview, items] = await Promise.all([api<Overview>(`organizations/${tenantId}/agency`), api<Organization[]>('organizations')]);
    setData(overview); setOrganizations(items);
  }, [tenantId]);
  useEffect(() => { let active = true; load().catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [load]);
  async function action(operation: () => Promise<unknown>, success: string) {
    setPending(true); setError(''); setMessage('');
    try { await operation(); await load(); setMessage(success); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось сохранить'); }
    finally { setPending(false); }
  }
  const canManage = data && ['OWNER', 'ADMIN'].includes(data.role);
  return <main className="page-container"><Link className="back-link" href={`/dashboard?organization=${tenantId}`}>В рабочее пространство</Link><div className="page-eyebrow">АГЕНТСТВО</div><h1>Клиенты</h1><p className="muted">Отдельная организация для каждого клиента: свои бренды, команда и баланс. Здесь видны только организации, в которых у вас есть доступ.</p>
    {loading ? <p role="status">Загружаем клиентов…</p> : null}{pending ? <p role="status">Сохраняем изменения…</p> : null}{error ? <p className="notice error" role="alert">{error}</p> : null}{message ? <p className="saved-message" role="status">{message}</p> : null}
    {data ? <>
      <section className="panel"><h2>Режим агентства {data.enabled ? 'включён' : 'выключен'}</h2><p className="muted">Связь с агентством не предоставляет его сотрудникам доступ к клиенту. Приглашайте участников отдельно в команде клиентской организации. Подписки и лимиты клиентов учитываются отдельно.</p>
        {data.role === 'OWNER' ? <button className="button secondary" disabled={pending} onClick={() => void action(() => api(`organizations/${tenantId}/agency`, 'PUT', { enabled: !data.enabled, revision: data.revision }), data.enabled ? 'Режим агентства выключен. Клиентские организации сохранены.' : 'Режим агентства включён')}>{data.enabled ? 'Выключить режим агентства' : 'Включить режим агентства'}</button> : <p className="muted">Включить или выключить режим может владелец организации.</p>}
      </section>
      {data.enabled ? <>
        {canManage ? <section className="panel brand-profile-editor agency-client-forms"><h2>Добавить клиента</h2><form className="inline-form" onSubmit={event => { event.preventDefault(); const key = createKey || crypto.randomUUID(); setCreateKey(key); void action(async () => { await api(`organizations/${tenantId}/agency/clients`, 'POST', { kind: 'CREATE', name, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, idempotencyKey: key }); setName(''); setCreateKey(''); }, 'Клиентская организация создана'); }}><div><label htmlFor="client-name">Название нового клиента</label><input id="client-name" required maxLength={120} value={name} disabled={pending} onChange={event => { setName(event.target.value); setCreateKey(''); }} /></div><button className="button primary" disabled={pending}>Создать клиента</button></form>
          <form className="inline-form" onSubmit={event => { event.preventDefault(); const key = linkKey || crypto.randomUUID(); setLinkKey(key); void action(async () => { await api(`organizations/${tenantId}/agency/clients`, 'POST', { kind: 'LINK', organizationId: existingId, idempotencyKey: key }); setExistingId(''); setLinkKey(''); }, 'Организация добавлена в портфель'); }}><div><label htmlFor="client-existing">Существующая организация</label><select id="client-existing" required disabled={pending} value={existingId} onChange={event => { setExistingId(event.target.value); setLinkKey(''); }}><option value="">Выберите организацию, которой владеете</option>{organizations.filter(item => item.id !== tenantId && item.role === 'OWNER' && !data.clients.some(client => client.organizationId === item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div><button className="button secondary" disabled={pending || !existingId}>Добавить существующую</button></form>
        </section> : null}
        <div className="section-heading"><h2>Клиентские организации</h2></div>{!data.clients.length ? <p className="panel muted">Нет доступных клиентских организаций. Создайте клиента или получите приглашение в его команду.</p> : <div className="brand-grid">{data.clients.map(client => <article className="panel" key={client.id}><h3>{client.name}</h3><p className="muted">{client.archivedAt ? 'В архиве портфеля' : 'Активный клиент'}</p><div className="brand-profile-actions"><Link className="button secondary" href={`/dashboard?organization=${client.organizationId}`}>Открыть клиента</Link>{['OWNER', 'ADMIN'].includes(client.role) ? <Link className="button secondary" href={`/team?organization=${client.organizationId}`}>Команда клиента</Link> : null}{canManage && (!client.archivedAt || client.role === 'OWNER') ? <button className="button secondary" disabled={pending} onClick={() => {
          if (!client.archivedAt && !window.confirm('Убрать клиента в архив портфеля? Его организация, контент и доступ участников сохранятся.')) return;
          void action(() => api(`organizations/${tenantId}/agency/clients/${client.id}`, 'PUT', { revision: client.revision, archived: !client.archivedAt }), client.archivedAt ? 'Клиент возвращён в портфель' : 'Клиент перемещён в архив портфеля');
        }}>{client.archivedAt ? 'Вернуть в портфель' : 'В архив портфеля'}</button> : null}</div></article>)}</div>}
      </> : null}
    </> : null}
  </main>;
}
