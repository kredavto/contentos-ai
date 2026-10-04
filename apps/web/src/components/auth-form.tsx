'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';
import { Button } from '@contentos/ui';
import { api } from '../lib/api-client';
type Mode = 'login' | 'register' | 'forgot-password' | 'reset-password' | 'verify' | 'resend-verification';
const titles: Record<Mode, [string, string]> = {
  login: ['С возвращением', 'Войдите в рабочее пространство вашего бренда.'],
  register: ['Ваш контент-отдел начинается здесь', 'Создайте аккаунт и соберите знания о вашем бизнесе.'],
  'forgot-password': ['Восстановить доступ', 'Отправим одноразовую ссылку на вашу почту.'],
  'reset-password': ['Новый пароль', 'После смены пароля все активные сессии будут закрыты.'],
  verify: ['Подтвердите вашу почту', 'Нажмите кнопку, чтобы завершить подтверждение адреса.'],
  'resend-verification': ['Новое письмо подтверждения', 'Отправим новую ссылку, если адрес ещё не подтверждён.'],
};
export function AuthForm({ mode }: { mode: Mode }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [token, setToken] = useState('');
  useEffect(() => {
    if (mode === 'reset-password' || mode === 'verify') {
      const incomingToken = new URLSearchParams(window.location.hash.slice(1)).get('token');
      if (incomingToken) {
        setToken(incomingToken);
        window.history.replaceState(null, '', window.location.pathname);
      }
    }
  }, [mode]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setMessage(''); setPending(true);
    const form = new FormData(event.currentTarget);
    const body: Record<string, string> = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]));
    if (mode === 'verify' || mode === 'reset-password') body.token = token;
    try {
      const result = await api<{ message?: string }>(`auth/${mode}`, 'POST', body);
      if (mode === 'login') { window.location.assign('/dashboard'); return; }
      setMessage(result.message ?? 'Готово');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Ошибка запроса'); }
    finally { setPending(false); }
  }
  return <div className="auth-card">
    <div className="icon-tile"><ShieldCheck size={24} /></div>
    <h1>{titles[mode][0]}</h1><p className="muted">{titles[mode][1]}</p>
    <form onSubmit={submit} className="stack">
      {mode === 'register' ? <label>Ваше имя<input name="name" autoComplete="name" required maxLength={120} placeholder="Как к вам обращаться" /></label> : null}
      {['login', 'register', 'forgot-password', 'resend-verification'].includes(mode) ? <label>Электронная почта<input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@company.ru" /></label> : null}
      {['login', 'register', 'reset-password'].includes(mode) ? <label>Пароль<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 12} maxLength={128} required placeholder={mode === 'login' ? 'Введите пароль' : 'Не менее 12 символов'} /></label> : null}
      {error ? <p className="notice error" role="alert">{error}</p> : null}
      {message ? <p className="notice success" role="status"><Mail size={18} />{message}</p> : null}
      <Button disabled={pending || Boolean(message) || ((mode === 'verify' || mode === 'reset-password') && !token)}>
        {pending ? <LoaderCircle size={18} className="spin" /> : <ArrowRight size={18} />}
        {mode === 'login' ? 'Войти в пространство' : mode === 'register' ? 'Создать аккаунт' : mode === 'verify' ? 'Подтвердить почту' : mode === 'reset-password' ? 'Сохранить пароль' : 'Отправить письмо'}
      </Button>
    </form>
    <div className="auth-links"><Link href={mode === 'login' ? '/register' : '/login'}>{mode === 'login' ? 'Создать аккаунт' : 'Войти в аккаунт'}</Link>{mode === 'login' ? <Link href="/forgot-password">Забыли пароль?</Link> : null}</div>
    {mode === 'verify' ? <Link href="/resend-verification" className="muted">Получить новую ссылку</Link> : null}
  </div>;
}
