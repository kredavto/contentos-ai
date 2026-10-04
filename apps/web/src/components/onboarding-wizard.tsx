'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, LoaderCircle, Save, Sparkles } from 'lucide-react';
import { emptyOnboarding, onboardingSaveSchema, type OnboardingData } from '@contentos/types';
import { api } from '../lib/api-client';
const steps: Array<{ key: keyof OnboardingData; title: string; subtitle: string; hint: string }> = [
  { key: 'company', title: 'Как называется ваш бренд?', subtitle: 'Начнём с основ', hint: 'Название, которое увидит ваша команда.' },
  { key: 'website', title: 'Где узнать о вас больше?', subtitle: 'Сайт компании', hint: 'Ссылка на ваш сайт. Можно оставить пустым. Мы не запускаем автоматический сбор данных.' },
  { key: 'niche', title: 'В какой нише вы работаете?', subtitle: 'Сфера бизнеса', hint: 'Расскажите, чем занимается компания и какую задачу она решает.' },
  { key: 'geography', title: 'Где находится ваша аудитория?', subtitle: 'География', hint: 'Страны, города и языки вашей аудитории.' },
  { key: 'products', title: 'Что вы предлагаете клиентам?', subtitle: 'Продукты и услуги', hint: 'Один продукт на строку. Формат: название | описание.' },
  { key: 'audience', title: 'Для кого вы создаёте контент?', subtitle: 'Целевая аудитория', hint: 'Один сегмент на строку: название | потребности и особенности.' },
  { key: 'pains', title: 'Что беспокоит ваших клиентов?', subtitle: 'Проблемы аудитории', hint: 'Одна проблема на строку: название | подробности.' },
  { key: 'competitors', title: 'С кем вас сравнивают?', subtitle: 'Конкуренты', hint: 'Название | особенности конкурента. Если конкурентов не знаете, оставьте пустым.' },
  { key: 'usp', title: 'Почему выбирают именно вас?', subtitle: 'Позиционирование', hint: 'Сформулируйте отличие, которое вы можете подтвердить.' },
  { key: 'voice', title: 'Как должен звучать ваш бренд?', subtitle: 'Tone of voice', hint: 'Например: спокойно, по делу, с примерами. Без давления и громких обещаний.' },
  { key: 'goals', title: 'Что должен приносить контент?', subtitle: 'Цели продвижения', hint: 'Каждая цель с новой строки: узнаваемость, заявки, доверие, продажи…' },
  { key: 'platforms', title: 'Где вы планируете публиковаться?', subtitle: 'Социальные сети', hint: 'Выбор каналов сохраняется в Brand Brain. Аккаунты подключаются отдельно.' },
  { key: 'ctas', title: 'Какой следующий шаг для клиента?', subtitle: 'Призывы к действию', hint: 'Название | действие. Например: консультация | записаться через сайт.' },
  { key: 'leadMagnets', title: 'Что полезного вы можете предложить?', subtitle: 'Лид-магниты', hint: 'Название | описание бесплатного материала. Шаг можно пропустить.' },
  { key: 'references', title: 'Покажите контент, который вам близок', subtitle: 'Ваши примеры', hint: 'Название | текст или ссылка на ваш материал. Шаг можно пропустить.' },
];
const listKeys = new Set(['products', 'audience', 'pains', 'competitors', 'ctas', 'leadMagnets', 'references']);
function valueAsText(data: OnboardingData, key: keyof OnboardingData): string {
  const value = data[key];
  if (typeof value === 'string') return value;
  return value.map(item => typeof item === 'string' ? item : `${item.name}${item.description ? ` | ${item.description}` : ''}`).join('\n');
}
export function OnboardingWizard({ tenantId, brandId }: { tenantId: string; brandId: string }) {
  const [data, setData] = useState(emptyOnboarding(''));
  const [step, setStep] = useState(0);
  const [revision, setRevision] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editor, setEditor] = useState('');
  useEffect(() => {
    let active = true;
    api<{ data: OnboardingData; role: string; brand: { revision: number; onboardingStep: number; onboardingCompletedAt: string | null } }>(`organizations/${tenantId}/brands/${brandId}`).then(result => {
      if (!active) return;
      setData(result.data); setRevision(result.brand.revision); setStep(result.brand.onboardingStep); setCompleted(Boolean(result.brand.onboardingCompletedAt)); setCanEdit(['OWNER', 'ADMIN', 'MANAGER'].includes(result.role));
      setEditor(valueAsText(result.data, steps[result.brand.onboardingStep]!.key));
    }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenantId, brandId]);
  function currentData() {
    const key = steps[step]!.key;
    if (key === 'platforms') return data;
    const value = listKeys.has(key) ? editor.split('\n').filter(line => line.trim()).map(line => { const [name, ...description] = line.split('|'); return { name: name!.trim(), description: description.join('|').trim() }; }) : key === 'goals' ? editor.split('\n').map(line => line.trim()).filter(Boolean) : editor;
    return { ...data, [key]: value } as OnboardingData;
  }
  async function save(nextStep: number, complete = false) {
    setError(''); setMessage('');
    const updated = currentData();
    const input = { data: updated, step: nextStep, revision, complete };
    const validated = onboardingSaveSchema.safeParse(input);
    if (!validated.success) {
      const issue = validated.error.issues[0]; const key = issue?.path[1];
      const field = steps.find(item => item.key === key);
      setError(`Проверьте ${field?.subtitle ?? 'поля формы'}: ${issue?.message ?? 'некорректное значение'}`); return;
    }
    setPending(true);
    try {
      const result = await api<{ revision: number }>(`organizations/${tenantId}/brands/${brandId}/onboarding`, 'PUT', input);
      setData(updated); setRevision(result.revision); setStep(nextStep); setEditor(valueAsText(updated, steps[nextStep]!.key)); setCompleted(complete); setMessage('Изменения сохранены');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось сохранить'); }
    finally { setPending(false); }
  }
  if (loading) return <div className="loading" role="status"><LoaderCircle className="spin" />Загружаем данные бренда…</div>;
  if (!canEdit && !completed) return <div className="page-container"><p className="notice error">{error || 'У вашей роли нет прав на изменение Brand Brain.'}</p><Link href="/dashboard">Вернуться в пространство</Link></div>;
  if (completed) return <div className="page-container brain-summary"><Link className="back-link" href="/dashboard"><ArrowLeft size={16} />В рабочее пространство</Link><div className="icon-tile"><Check /></div><div className="page-eyebrow">КОНТЕКСТ СОХРАНЁН</div><h1>Brand Brain: {data.company}</h1><p className="muted">Структурированная основа вашего бренда готова. Эти данные будут использоваться при создании стратегии и контента.</p><div className="summary-grid">{steps.map(item => <section className="panel" key={item.key}><h3>{item.subtitle}</h3><p className="preserve-lines">{valueAsText(data, item.key) || 'Не указано'}</p></section>)}</div></div>;
  return <div className="wizard-layout">
    <aside className="wizard-sidebar"><Link className="back-link" href="/dashboard"><ArrowLeft size={16} />Все бренды</Link><h2>Знакомство с брендом</h2><p className="muted">15 шагов, чтобы сохранить ваш контекст.</p><ol className="step-list">{steps.map((item, index) => <li key={item.key} className={index === step ? 'current' : ''}><button disabled={pending} onClick={() => void save(index)} aria-current={index === step ? 'step' : undefined}><span>{index + 1}</span>{item.subtitle}</button></li>)}</ol></aside>
    <section className="wizard-main"><div className="wizard-progress"><span>ШАГ {step + 1} ИЗ 15</span><span>{Math.round((step + 1) / 15 * 100)}%</span></div><div className="progress-track"><span style={{ width: `${(step + 1) / 15 * 100}%` }} /></div>
      <div className="wizard-content"><div className="icon-tile"><Sparkles /></div><h1>{steps[step]!.title}</h1><p className="muted">{steps[step]!.hint}</p>
        {steps[step]!.key === 'platforms' ? <fieldset className="platform-options"><legend className="sr-only">Каналы публикации</legend>{(['YOUTUBE', 'TIKTOK', 'INSTAGRAM', 'VK', 'TELEGRAM'] as const).map(platform => <label key={platform}><input type="checkbox" checked={data.platforms.includes(platform)} onChange={event => setData(value => ({ ...value, platforms: event.target.checked ? [...value.platforms, platform] : value.platforms.filter(item => item !== platform) }))} />{platform}</label>)}</fieldset> : <div><label htmlFor="onboarding-value">{steps[step]!.subtitle}</label>{step < 2 ? <input id="onboarding-value" autoComplete="off" value={editor} onChange={event => setEditor(event.target.value)} maxLength={step === 0 ? 120 : 1000} /> : <textarea id="onboarding-value" rows={7} value={editor} onChange={event => setEditor(event.target.value)} maxLength={listKeys.has(steps[step]!.key) ? 40000 : 6000} />}</div>}
        {error ? <p className="notice error" role="alert">{error}</p> : null}{message ? <p className="saved-message" role="status"><Check size={16} />{message}</p> : null}
      </div>
      <div className="wizard-actions"><button className="button secondary" disabled={pending} onClick={() => void save(step)}><Save size={17} />Сохранить</button><div>{step > 0 ? <button className="button secondary" disabled={pending} onClick={() => void save(step - 1)}>Назад</button> : null}<button className="button primary" disabled={pending} onClick={() => void save(Math.min(14, step + 1), step === 14)}>{pending ? <LoaderCircle className="spin" size={17} /> : null}{step === 14 ? 'Создать Brand Brain' : 'Продолжить'}<ArrowRight size={17} /></button></div></div>
    </section>
  </div>;
}
