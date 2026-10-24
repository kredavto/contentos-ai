'use client';
import { useState } from 'react';
import { brandProfileSaveSchema, type BrandProfileData, type OnboardingData } from '@contentos/types';
import { api } from '../lib/api-client';
const fields = [
  ['company', 'Название бренда'], ['website', 'Сайт'], ['niche', 'Ниша'], ['geography', 'География'],
  ['usp', 'Позиционирование'], ['voice', 'Голос бренда'],
] as const;
export function BrandProfileEditor({ tenantId, brandId, data, revision, onSaved, onCancel }: {
  tenantId: string; brandId: string; data: OnboardingData; revision: number;
  onSaved: (data: BrandProfileData, revision: number) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BrandProfileData>(() => ({ company: data.company, website: data.website, niche: data.niche, geography: data.geography, usp: data.usp, voice: data.voice, goals: data.goals, platforms: data.platforms }));
  const [goals, setGoals] = useState(data.goals.join('\n'));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    const parsed = brandProfileSaveSchema.safeParse({ revision, data: { ...draft, goals: goals.split('\n').map(value => value.trim()).filter(Boolean) } });
    if (!parsed.success) { setError('Заполните обязательные поля, добавьте цель и выберите хотя бы один канал. Проверьте адрес сайта и длину текста.'); return; }
    setPending(true); setError('');
    try {
      const result = await api<{ revision: number }>(`organizations/${tenantId}/brands/${brandId}/profile`, 'PUT', parsed.data);
      onSaved(parsed.data.data, result.revision);
    } catch (failure) { setError(`${failure instanceof Error ? failure.message : 'Не удалось сохранить'}. Если данные уже изменены другим участником, скопируйте свой текст и обновите страницу.`); }
    finally { setPending(false); }
  }
  return <form className="panel brand-profile-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h2>Редактировать профиль бренда</h2><p className="muted">Изменения используются в новых генерациях. Ранее созданные стратегии и сценарии сохраняют свою историю.</p>
    <fieldset disabled={pending}>
      {fields.map(([key, label]) => <div className="brand-profile-field" key={key}><label htmlFor={`brand-profile-${key}`}>{label}{key === 'website' ? ' (необязательно)' : ''}</label>
        {key === 'company' || key === 'website' ? <input id={`brand-profile-${key}`} value={draft[key]} maxLength={key === 'company' ? 120 : 1000} required={key !== 'website'} onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))} /> : <textarea id={`brand-profile-${key}`} value={draft[key]} rows={3} maxLength={2000} required onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))} />}
      </div>)}
      <div className="brand-profile-field"><label htmlFor="brand-profile-goals">Цели — по одной на строке</label><textarea id="brand-profile-goals" value={goals} maxLength={6020} rows={3} required onChange={event => setGoals(event.target.value)} /></div>
      <fieldset className="platform-options"><legend>Каналы публикации</legend>{(['YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'VK', 'TELEGRAM'] as const).map(platform => <label key={platform}><input type="checkbox" checked={draft.platforms.includes(platform)} onChange={event => setDraft(value => ({ ...value, platforms: event.target.checked ? [...value.platforms, platform] : value.platforms.filter(item => item !== platform) }))} />{platform}</label>)}</fieldset>
    </fieldset>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    <div className="brand-profile-actions"><button className="button primary" disabled={pending} type="submit">{pending ? 'Сохраняем…' : 'Сохранить профиль'}</button><button className="button secondary" disabled={pending} type="button" onClick={onCancel}>Отмена</button></div>
  </form>;
}
