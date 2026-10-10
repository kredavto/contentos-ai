'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PrivacyService } from '@contentos/core';
import { api } from '../lib/api-client';
type Overview = Awaited<ReturnType<PrivacyService['overview']>>;
type Organization = { id: string; name: string; role: string };
type Brand = { id: string; name: string; onboardingCompletedAt: string | null };
export function PrivacyCenter() {
  const [data, setData] = useState<Overview | null>(null), [organizations, setOrganizations] = useState<Organization[]>([]);
  const [tenant, setTenant] = useState(''), [brands, setBrands] = useState<Brand[]>([]), [brand, setBrand] = useState('');
  const [exportPassword, setExportPassword] = useState('');
  const [password, setPassword] = useState(''), [acknowledged, setAcknowledged] = useState(false), [intent, setIntent] = useState('');
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => { let active = true; Promise.all([api<Overview>('privacy'), api<Organization[]>('organizations')]).then(([overview, items]) => { if (active) { setData(overview); setOrganizations(items); setTenant(items[0]?.id ?? ''); } }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, []);
  useEffect(() => { let active = true; setBrands([]); setBrand(''); if (tenant) api<{ brands: Brand[] }>(`organizations/${tenant}`).then(result => { if (active) { setBrands(result.brands); setBrand(result.brands[0]?.id ?? ''); } }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, [tenant]);
  async function downloadAccount() {
    setPending(true); setError(''); setMessage('');
    try {
      const archive = await api<Awaited<ReturnType<PrivacyService['exportAccount']>>>('privacy/export', 'POST', { password: exportPassword });
      const url = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'contentos-account.json'; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Файл данных аккаунта подготовлен для скачивания.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось подготовить файл'); }
    finally { setExportPassword(''); setPending(false); }
  }
  async function requestDeletion() {
    if (!window.confirm('Зарегистрировать запрос на удаление аккаунта? Это ещё не удалит аккаунт и данные. До начала обработки запрос можно отменить.')) return;
    const key = intent || crypto.randomUUID(); setIntent(key); setPending(true); setError(''); setMessage('');
    try { const result = await api<Overview['requests'][number]>('privacy/deletion', 'POST', { password, acknowledged, idempotencyKey: key }); setMessage(result.status === 'REQUESTED' ? 'Запрос зарегистрирован и ожидает обработки. Аккаунт и данные пока сохранены.' : 'Этот запрос уже отменён. Для нового запроса заполните форму ещё раз.'); setData(await api<Overview>('privacy')); setIntent(''); setAcknowledged(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось зарегистрировать запрос'); }
    finally { setPassword(''); setPending(false); }
  }
  async function cancel(request: Overview['requests'][number]) {
    setPending(true); setError(''); setMessage('');
    try { await api('privacy/deletion/cancel', 'POST', { requestId: request.id, revision: request.revision }); setData(await api<Overview>('privacy')); setMessage('Запрос отменён.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось отменить запрос'); }
    finally { setPending(false); }
  }
  async function revokeSessions() {
    if (!window.confirm('Выйти из аккаунта на всех устройствах, включая это?')) return;
    setPending(true); setError('');
    try { await api('auth/revoke-sessions', 'POST'); window.location.assign('/login'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось завершить сессии'); setPending(false); }
  }
  const selectedBrand = brands.find(item => item.id === brand);
  return <div className="page-container"><Link className="back-link" href="/dashboard">В рабочее пространство</Link><div className="page-eyebrow">ДАННЫЕ И ДОСТУП</div><h1>Приватность</h1>
    {error ? <p className="notice error" role="alert">{error}</p> : null}{message ? <p className="saved-message" role="status">{message}</p> : null}
    {!data ? <p>Загружаем настройки приватности…</p> : <>
      <section className="panel"><h2>Ваш аккаунт</h2><p>{data.user.name} · {data.user.email}</p><p>Активных сессий: {data.activeSessions}</p><button className="button secondary" disabled={pending} onClick={() => void revokeSessions()}>Выйти на всех устройствах</button></section>
      <section className="panel brand-profile-editor"><h2>Скачать данные аккаунта</h2><p>JSON-файл содержит профиль, роли в организациях, даты сеансов, историю подтверждения почты и сброса пароля, статусы служебных писем, ваши согласия и их отзывы, согласия на автопродление, даты и типы ваших действий, запросы на удаление. Материалы брендов, медиа, платёжные операции, содержимое писем и данные других людей не включаются.</p>
        {data.user.verifiedAt ? <form onSubmit={event => { event.preventDefault(); void downloadAccount(); }}><label htmlFor="export-password">Пароль для скачивания данных</label><input id="export-password" type="password" autoComplete="current-password" required maxLength={128} disabled={pending} value={exportPassword} onChange={event => setExportPassword(event.target.value)} /><button className="button secondary" disabled={pending || !exportPassword}>Скачать JSON</button></form> : <p><Link href="/resend-verification">Подтвердите почту</Link>, чтобы скачать данные.</p>}
      </section>
      <section className="panel brand-profile-editor"><h2>Данные бренда и разрешения</h2><p className="muted">Доступные действия зависят от вашей роли в организации. Удаление медиа выполняется отдельным процессом; его статус доступен в соответствующем разделе.</p>
        {organizations.length ? <><label htmlFor="privacy-organization">Организация для управления данными</label><select id="privacy-organization" value={tenant} onChange={event => setTenant(event.target.value)}>{organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <label htmlFor="privacy-brand">Бренд для управления данными</label><select id="privacy-brand" value={brand} onChange={event => setBrand(event.target.value)} disabled={!brands.length}>{!brands.length ? <option value="">Нет брендов</option> : brands.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          {selectedBrand?.onboardingCompletedAt ? <div className="summary-grid">{([['consents', 'Отозвать согласия'], ['integrations', 'Отключить соцсети'], ['avatars', 'Управлять аватарами'], ['videos', 'Удалить сгенерированные видео'], ['media', 'Удалить исходные фотографии']] as const).map(([tab, label]) => <Link className="button secondary" key={tab} href={`/brands/${brand}/content?organization=${tenant}&tab=${tab}`}>{label}</Link>)}</div> : selectedBrand ? <Link className="button secondary" href={`/brands/${brand}/onboarding?organization=${tenant}`}>Открыть настройки бренда</Link> : null}
        </> : <p>Вы пока не состоите в организациях.</p>}
      </section>
      <section className="panel brand-profile-editor"><h2>Запрос на удаление аккаунта</h2><p>Запрос сохраняется для обработки оператором. Автоматическое удаление аккаунта пока недоступно. Отправка запроса не удаляет данные и не отключает доступ.</p>
        {data.ownedOrganizations.length ? <div><p>Вы владеете организациями. Перед удалением потребуется передать владение или отдельно решить судьбу их данных:</p>{data.ownedOrganizations.map(item => <p key={item.id}><Link href={`/team?organization=${item.id}`}>{item.name} — управление командой</Link></p>)}</div> : null}
        {!data.user.verifiedAt ? <p><Link href="/resend-verification">Подтвердите почту</Link>, чтобы отправить запрос.</p> : !data.requests.some(request => request.status === 'REQUESTED') ? <form onSubmit={event => { event.preventDefault(); void requestDeletion(); }}>
          <label htmlFor="privacy-password">Текущий пароль</label><input id="privacy-password" type="password" autoComplete="current-password" required maxLength={128} value={password} disabled={pending} onChange={event => setPassword(event.target.value)} />
          <label className="consent-checkbox"><input type="checkbox" checked={acknowledged} disabled={pending} onChange={event => setAcknowledged(event.target.checked)} />Я понимаю, что отправляю запрос, а удаление ещё не выполнено.</label>
          <button className="button secondary" disabled={pending || !acknowledged || !password}>Запросить удаление аккаунта</button>
        </form> : null}
        <h3>Последние 20 запросов</h3>{!data.requests.length ? <p>Запросов нет.</p> : data.requests.map(request => <article key={request.id}><p>{request.status === 'REQUESTED' ? 'Ожидает обработки' : 'Отменён'} · {new Date(String(request.createdAt)).toLocaleString('ru-RU')}</p><small>ID: {request.id}</small>{request.status === 'REQUESTED' ? <p><button className="button secondary" disabled={pending} onClick={() => void cancel(request)}>Отменить запрос</button></p> : null}</article>)}
      </section>
    </>}
  </div>;
}
