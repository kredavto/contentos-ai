'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Building2, Plus, FolderOpen, CheckCircle2, LayoutDashboard, Lightbulb, CalendarDays, Clapperboard, BarChart3, Settings2, LogOut, Sparkles, ArrowRight, LoaderCircle } from 'lucide-react';
import { NotificationLink } from './notification-center';
import { api } from '../lib/api-client';
type Organization = { id: string; name: string; role: string };
type Overview = { role: string; workspaces: Array<{ id: string; name: string }>; brands: Array<{ id: string; name: string; onboardingStep: number; onboardingCompletedAt: string | null }> };
export function Workspace({ name, verified, initialOrganization, platformOperator }: { name: string; verified: boolean; initialOrganization:string|null; platformOperator:boolean }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [tenant, setTenant] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [creatingOrganization, setCreatingOrganization] = useState(false);
  const [creatingBrand, setCreatingBrand] = useState(false);
  const load = useCallback(async () => {
    try { const items = await api<Organization[]>('organizations'); setOrganizations(items); setTenant(current => items.some(item=>item.id===current)?current:items.find(item=>item.id===initialOrganization)?.id||items[0]?.id||''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Ошибка загрузки'); }
    finally { setLoading(false); }
  }, [initialOrganization]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!tenant) return;
    let active = true; setOverview(null);
    api<Overview>(`organizations/${tenant}`).then(data => { if (active) setOverview(data); }).catch(failure => { if (active) setError(String(failure.message)); });
    return () => { active = false; };
  }, [tenant]);
  async function create(event: FormEvent<HTMLFormElement>, kind: 'organization' | 'brand') {
    event.preventDefault(); setPending(true); setError('');
    const form = new FormData(event.currentTarget);
    try {
      if (kind === 'organization') {
        const created = await api<Organization>('organizations', 'POST', { name: form.get('name'), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        await load(); setTenant(created.id); setCreatingOrganization(false);
      } else {
        const created = await api<{ id: string }>(`organizations/${tenant}/brands`, 'POST', { name: form.get('name'), workspaceId: overview?.workspaces[0]?.id });
        window.location.assign(`/brands/${created.id}/onboarding?organization=${tenant}`);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось сохранить'); }
    finally { setPending(false); }
  }
  async function logout() { try { await api('auth/logout', 'POST'); window.location.assign('/login'); } catch { setError('Не удалось завершить сессию'); } }
  return <div className="workspace">
    <aside className="sidebar">
      <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <label className="sr-only" htmlFor="organization-select">Организация</label>
      <select id="organization-select" value={tenant} onChange={event => setTenant(event.target.value)} disabled={!organizations.length}>
        {!organizations.length ? <option>Нет организаций</option> : organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <button className="text-button" onClick={() => setCreatingOrganization(true)}><Plus size={15} />Добавить организацию</button>
      <div className="mobile-account"><span>{name}</span><button className="icon-button" aria-label="Выйти из аккаунта" onClick={logout}><LogOut size={18} /></button></div>
      <nav className="side-nav" aria-label="Разделы"><Link href="/privacy"><Settings2 size={18} />Приватность</Link>{platformOperator ? <Link href="/admin"><Settings2 size={18} />Администрирование</Link> : null}{tenant && overview && ['OWNER', 'ADMIN', 'MANAGER'].includes(overview.role) ? <Link href={`/clients?organization=${tenant}`}><Building2 size={18} />Клиенты</Link> : null}<Link className="active" href="/dashboard"><LayoutDashboard size={18} />Обзор</Link>
        {[['Стратегия', Sparkles], ['Идеи', Lightbulb], ['Календарь', CalendarDays], ['Видеостудия', Clapperboard], ['Аналитика', BarChart3], ['Настройки', Settings2]].map(([label, Icon]) => { const NavIcon = Icon as typeof Sparkles; return <button key={String(label)} disabled title="Раздел в разработке"><NavIcon size={18} />{String(label)}<span className="soon">скоро</span></button>; })}
      </nav>
      <div className="sidebar-bottom"><span className="avatar-letter">{name.slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><small>Ваш аккаунт</small></div><button className="icon-button" aria-label="Выйти" onClick={logout}><LogOut size={18} /></button></div>
    </aside>
    <div className="workspace-main">
      <div className="page-eyebrow">ВАШ КОНТЕНТ. ВАША СИСТЕМА.</div>
      <div className="page-title"><div><h1>Всё начинается с бренда</h1><p className="muted">Соберите контекст один раз. Сохраняйте его для всей контент-команды.</p></div><div>{tenant?<NotificationLink key={tenant} tenantId={tenant}/>:null}{tenant&&overview&&['OWNER','ADMIN'].includes(overview.role)?<Link className="button secondary" href={`/team?organization=${tenant}`}>Команда</Link>:null}{tenant&&overview?.role==='OWNER'?<Link className="button secondary" href={`/billing?organization=${tenant}`}>Биллинг</Link>:null}<span className="badge">Ранний доступ</span></div></div>
      {!verified ? <p className="notice warning">Подтвердите почту перед подключением AI-сервисов. <Link href="/resend-verification">Отправить письмо</Link></p> : null}
      {error ? <p className="notice error" role="alert">{error}</p> : null}
      {loading ? <div className="panel loading" role="status"><LoaderCircle className="spin" />Загружаем рабочее пространство…</div> : null}
      {!loading && (!organizations.length || creatingOrganization) ? <section className="panel setup-panel"><div className="icon-tile"><Building2 /></div><h2>Создайте организацию</h2><p className="muted">В ней будут ваши бренды, участники команды и настройки доступа.</p><form onSubmit={event => create(event, 'organization')} className="inline-form"><label>Название организации<input name="name" required maxLength={120} placeholder="Например, Северная студия" /></label><button className="button primary" disabled={pending}>Создать организацию<ArrowRight size={17} /></button></form></section> : null}
      {tenant && overview ? <>
        <section className="hero-panel"><div><span className="badge dark">BRAND BRAIN</span><h2>Превратите знания о бизнесе<br />в основу сильного контента.</h2><p>Продукты, аудитория, позиционирование и голос бренда —<br />в одном структурированном пространстве.</p><button className="button light" onClick={() => setCreatingBrand(true)} disabled={!['OWNER', 'ADMIN', 'MANAGER'].includes(overview.role)}><Plus size={18} />Добавить бренд</button></div><div className="brain-graphic" aria-hidden="true"><div className="brain-ring ring-one" /><div className="brain-ring ring-two" /><div className="brain-core"><Sparkles size={44} /></div><span className="brain-node node-one">Аудитория</span><span className="brain-node node-two">Голос бренда</span><span className="brain-node node-three">Продукты</span></div></section>
        {creatingBrand ? <section className="panel"><h2>Новый бренд</h2><form className="inline-form" onSubmit={event => create(event, 'brand')}><label>Название бренда<input name="name" required maxLength={120} placeholder="Название вашего бренда" /></label><button className="button primary" disabled={pending}>Перейти к настройке<ArrowRight size={17} /></button></form></section> : null}
        <div className="section-heading"><h2>Ваши бренды <span className="count">{overview.brands.length}</span></h2><span className="muted">Контекст под вашим контролем</span></div>
        {!overview.brands.length ? <div className="panel empty"><FolderOpen size={34} /><h3>Здесь будут ваши бренды</h3><p className="muted">Добавьте первый бренд и пройдите короткую настройку.</p></div> : <div className="brand-grid">{overview.brands.map(brand => <Link className="brand-card" key={brand.id} href={`/brands/${brand.id}/${brand.onboardingCompletedAt ? 'content' : 'onboarding'}?organization=${tenant}`}><div className="brand-card-top"><span className="brand-monogram">{brand.name.slice(0, 2).toUpperCase()}</span><ArrowUpRight size={20} /></div><h3>{brand.name}</h3><p>{brand.onboardingCompletedAt ? <><CheckCircle2 size={15} />Brand Brain готов</> : `Настройка: шаг ${brand.onboardingStep + 1} из 15`}</p><div className="progress-track"><span style={{ width: `${brand.onboardingCompletedAt ? 100 : (brand.onboardingStep + 1) / 15 * 100}%` }} /></div></Link>)}</div>}
      </> : null}
      <p className="implementation-note">Откройте настроенный бренд, чтобы работать со стратегией, идеями и сценариями. Видеостудия, календарь и публикации доступны внутри бренда.</p>
    </div>
  </div>;
}
