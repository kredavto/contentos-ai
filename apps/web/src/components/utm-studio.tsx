'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { UtmService } from '@contentos/core';
import { buildUtmUrl, utmFieldsSchema, type UtmFields } from '@contentos/types';
import { api } from '../lib/api-client';
type Listing = Awaited<ReturnType<UtmService['list']>>;
const initial: UtmFields = { name: '', destinationUrl: '', source: '', medium: 'social', campaign: '', term: '', content: '' };
const labels: Array<[keyof UtmFields, string, number]> = [['name', 'Название ссылки', 120], ['destinationUrl', 'Адрес страницы', 2048], ['source', 'Источник (utm_source)', 100], ['medium', 'Канал (utm_medium)', 100], ['campaign', 'Кампания (utm_campaign)', 100], ['content', 'Вариант контента (utm_content)', 100], ['term', 'Ключевое слово (utm_term)', 100]];
export function UtmStudio({ base, canWrite }: { base: string; canWrite: boolean }) {
  const previewId = useId(), statusId = useId(), searchId = useId();
  const [draft, setDraft] = useState(initial), [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED'>('ACTIVE');
  const [listing, setListing] = useState<Listing | null>(null), [before, setBefore] = useState(''), [reload, setReload] = useState(0);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [searchDraft, setSearchDraft] = useState(''), [search, setSearch] = useState('');
  const intent = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => { let active = true; setListing(null); setError(''); api<Listing>(`${base}/utm?status=${status}&search=${encodeURIComponent(search)}${before ? `&before=${before}` : ''}`).then(result => { if (active) setListing(result); }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, [base, status, before, search, reload]);
  const parsed = utmFieldsSchema.safeParse(draft);
  const preview = parsed.success ? buildUtmUrl(parsed.data) : '';
  const valid = !!preview && preview.length <= 4096;
  async function save() {
    if (!valid) return;
    setPending(true); setError(''); setNotice('');
    const payload = JSON.stringify(draft);
    if (intent.current?.payload !== payload) intent.current = { payload, key: crypto.randomUUID() };
    try {
      const result = await api<Listing['rows'][number]>(`${base}/utm`, 'POST', { ...draft, idempotencyKey: intent.current.key });
      intent.current = null; setDraft(initial); setBefore(''); setSearch(''); setSearchDraft(''); setStatus(result.archivedAt ? 'ARCHIVED' : 'ACTIVE'); setReload(value => value + 1);
      setNotice(result.archivedAt ? 'Эта ссылка уже сохранена в архиве.' : 'UTM-ссылка сохранена.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось сохранить ссылку'); }
    finally { setPending(false); }
  }
  async function archive(row: Listing['rows'][number]) {
    setPending(true); setError(''); setNotice('');
    try { await api(`${base}/utm/${row.id}/archive`, 'POST', { revision: row.revision, archived: !row.archivedAt }); setReload(value => value + 1); setNotice(row.archivedAt ? 'Ссылка восстановлена.' : 'Ссылка перенесена в архив. Уже опубликованный адрес продолжит работать.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось изменить архив'); }
    finally { setPending(false); }
  }
  async function copy(value: string) {
    setError(''); setNotice('');
    try { await navigator.clipboard.writeText(value); setNotice('Ссылка скопирована.'); }
    catch { setError('Браузер запретил копирование. Выделите адрес в поле и скопируйте вручную.'); }
  }
  return <section className="stack"><div><h2>UTM-ссылки</h2><p className="muted">Создайте ссылку для CTA и вставьте её в текст публикации. Переходы и заявки смотрите в подключённой аналитике целевой страницы. Здесь они пока не учитываются.</p></div>
    {error ? <p className="notice error" role="alert">{error}</p> : null}{notice ? <p className="saved-message" role="status">{notice}</p> : null}
    {canWrite ? <form className="panel brand-profile-editor" onSubmit={event => { event.preventDefault(); void save(); }}><h3>Новая ссылка</h3><p className="muted">Обязательны название, адрес, источник, канал и кампания. Старые UTM-метки в адресе будут заменены; остальные параметры и якорь сохранятся.</p>
      <fieldset disabled={pending}><div className="studio-form">{labels.map(([field, label, max]) => <label key={field}>{label}<input type={field === 'destinationUrl' ? 'url' : 'text'} value={draft[field]} maxLength={max} required={!['term', 'content'].includes(field)} placeholder={field === 'destinationUrl' ? 'https://example.com/page' : field === 'source' ? 'telegram' : undefined} onChange={event => setDraft(value => ({ ...value, [field]: event.target.value }))} /></label>)}</div></fieldset>
      <label htmlFor={previewId}>Предпросмотр ссылки</label><textarea id={previewId} readOnly value={valid ? preview : ''} rows={3} placeholder="Заполните обязательные поля корректными значениями" />
      <button className="button primary" disabled={pending || !valid}>Сохранить UTM-ссылку</button>
    </form> : <p className="muted">Создавать и архивировать ссылки могут подтверждённые владельцы, администраторы, менеджеры и редакторы.</p>}
    <div className="studio-actions"><div><label htmlFor={statusId}>Состояние ссылок</label><select id={statusId} disabled={pending} value={status} onChange={event => { setStatus(event.target.value as typeof status); setBefore(''); }}>{['ACTIVE', 'ARCHIVED'].map(value => <option key={value} value={value}>{value === 'ACTIVE' ? 'Активные' : 'Архив'}</option>)}</select></div><button className="button secondary" disabled={pending} onClick={() => { setBefore(''); setReload(value => value + 1); }}>Обновить список</button></div>
    <form className="stack" onSubmit={event => { event.preventDefault(); setSearch(searchDraft.trim()); setBefore(''); setReload(value => value + 1); }}>
      <label htmlFor={searchId}>Поиск UTM-ссылок</label><input id={searchId} type="search" maxLength={100} value={searchDraft} disabled={pending} placeholder="Название, кампания или источник" onChange={event => setSearchDraft(event.target.value)} />
      <div className="studio-actions"><button className="button secondary" disabled={pending}>Найти ссылки</button>{search || searchDraft ? <button type="button" className="button secondary" disabled={pending} onClick={() => { setSearch(''); setSearchDraft(''); setBefore(''); setReload(value => value + 1); }}>Сбросить поиск</button> : null}</div>
      {search ? <p className="muted">Результаты поиска: «{search}». Поиск действует в выбранном состоянии ссылок.</p> : null}
    </form>
    {!listing ? (error ? null : <p>Загрузка ссылок…</p>) : !listing.rows.length ? <p>{search ? 'По вашему запросу ссылок не найдено.' : 'В этом списке ссылок нет.'}</p> : listing.rows.map(row => <article className="panel brand-profile-editor" key={row.id}><h3>{row.name}</h3><p>{row.source} · {row.medium} · {row.campaign}</p><label htmlFor={`utm-${row.id}`}>Сохранённая ссылка: {row.name}</label><textarea id={`utm-${row.id}`} readOnly rows={3} value={row.taggedUrl} /><div className="studio-actions"><button className="button secondary" onClick={() => void copy(row.taggedUrl)}>Копировать {row.name}</button>{canWrite ? <button className="text-button" disabled={pending} onClick={() => void archive(row)}>{row.archivedAt ? 'Восстановить' : 'В архив'}</button> : null}</div></article>)}
    <div className="studio-actions">{before ? <button className="button secondary" disabled={pending} onClick={() => setBefore('')}>В начало списка</button> : null}{listing?.nextCursor ? <button className="button secondary" disabled={pending} onClick={() => setBefore(listing.nextCursor!)}>Следующие 50</button> : null}</div>
  </section>;
}
