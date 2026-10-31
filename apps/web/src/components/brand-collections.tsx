'use client';
import { useEffect, useState } from 'react';
import { brainCollections, brainCollectionSaveSchema, type BrainCollection, type BrainEntry } from '@contentos/types';
import { api } from '../lib/api-client';
const names: Record<BrainCollection, string> = { products: 'Продукты', audience: 'Аудитории', pains: 'Проблемы', desires: 'Желания', objections: 'Возражения', competitors: 'Конкуренты', positioning: 'Позиционирование', pillars: 'Контентные направления', offers: 'Предложения', leadMagnets: 'Лид-магниты', ctas: 'Призывы к действию', rules: 'Правила бренда', references: 'Примеры контента' };
export function BrandCollections({ tenantId, brandId, canEdit, onSaved, onDirty }: { tenantId: string; brandId: string; canEdit: boolean; onSaved: () => void; onDirty: (dirty: boolean) => void }) {
  const [collection, setCollection] = useState<BrainCollection>('products');
  const [entries, setEntries] = useState<BrainEntry[]>([]);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true), [pending, setPending] = useState(false), [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    api<{ revision: number; entries: BrainEntry[] }>(`organizations/${tenantId}/brands/${brandId}/brain/${collection}`).then(result => {
      if (active) { setLoaded(true); setEntries(result.entries); setRevision(result.revision); setDirty(false); }
    }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId, brandId, collection]);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  function update(index: number, patch: Partial<BrainEntry>) { setEntries(value => value.map((row, i) => i === index ? { ...row, ...patch } : row)); setDirty(true); setMessage(''); }
  async function save() {
    const input = brainCollectionSaveSchema.safeParse({ revision, entries });
    if (!input.success) { setError('Добавьте названия пунктов и проверьте длину текста.'); return; }
    setPending(true); setError(''); setMessage('');
    try {
      await api(`organizations/${tenantId}/brands/${brandId}/brain/${collection}`, 'PUT', input.data);
      setDirty(false); onSaved();
    } catch (failure) { setError(`${failure instanceof Error ? failure.message : 'Не удалось сохранить'}. При конфликте сохраните свой текст и обновите страницу.`); }
    finally { setPending(false); }
  }
  return <section className="panel brand-profile-editor"><h2>Структура Brand Brain</h2><p className="muted">Контекст для новых стратегий и контента. Удалённые пункты сохраняются в связях ранее созданных материалов.</p>
    <label htmlFor="brain-collection">Раздел</label><select id="brain-collection" value={collection} disabled={pending} onChange={event => {
      if (dirty && !window.confirm('Перейти в другой раздел без сохранения изменений?')) return;
      setLoading(true); setLoaded(false); setDirty(false); setEntries([]); setError(''); setMessage(''); setCollection(event.target.value as BrainCollection);
    }}>{brainCollections.map(key => <option key={key} value={key}>{names[key]}</option>)}</select>
    {loading ? <p role="status">Загружаем раздел…</p> : loaded ? <>
      {!entries.length ? <p className="muted">В этом разделе пока нет пунктов.</p> : null}
      {entries.map((entry, index) => <fieldset className="brain-entry" key={entry.id ?? `new-${index}`} disabled={!canEdit || pending}><legend>Пункт {index + 1}</legend>
        <label htmlFor={`brain-name-${index}`}>Название {index + 1}</label><input id={`brain-name-${index}`} value={entry.name} maxLength={200} onChange={event => update(index, { name: event.target.value })} />
        <label htmlFor={`brain-description-${index}`}>Описание {index + 1}</label><textarea id={`brain-description-${index}`} value={entry.description} rows={3} maxLength={2000} onChange={event => update(index, { description: event.target.value })} />
        {canEdit ? <button type="button" className="button secondary" onClick={() => { setEntries(value => value.filter((_, i) => i !== index)); setDirty(true); }}>Убрать пункт {index + 1}</button> : null}
      </fieldset>)}
      {canEdit ? <div className="brand-profile-actions"><button type="button" className="button secondary" disabled={pending || entries.length >= (['ctas', 'leadMagnets', 'references'].includes(collection) ? 20 : 40)} onClick={() => { setEntries(value => [...value, { name: '', description: '' }]); setDirty(true); }}>Добавить пункт</button><button type="button" className="button primary" disabled={pending || !dirty} onClick={() => void save()}>{pending ? 'Сохраняем…' : 'Сохранить раздел'}</button></div> : null}
    </> : null}
    {error ? <p className="notice error" role="alert">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
  </section>;
}
