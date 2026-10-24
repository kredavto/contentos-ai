'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api-client';
export function JoinTeam(){
  const [token,setToken]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false),[tenant,setTenant]=useState('');
  useEffect(()=>{const value=window.location.hash.slice(1);if(/^[a-zA-Z0-9_-]{43}$/.test(value))setToken(value);else setError('Ссылка приглашения отсутствует или некорректна. Запросите новую ссылку у администратора.');},[]);
  async function accept(){setPending(true);setError('');try{const result=await api<{tenantId:string}>('team/accept','POST',{token});setTenant(result.tenantId);setToken('');window.history.replaceState(null,'','/join');}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось принять приглашение');}finally{setPending(false);}}
  return <main className="workspace-main content-studio"><section className="panel"><h1>Приглашение в команду</h1>{tenant?<><p role="status">Вы присоединились к организации.</p><Link className="button primary" href={`/dashboard?organization=${tenant}`}>Открыть рабочее пространство</Link></>:<><p>Войдите в аккаунт с тем email, на который выданы права, и подтвердите адрес. Приглашение действует 7 дней.</p><p><Link href="/login" target="_blank" rel="noopener noreferrer">Войти в новой вкладке</Link> · <Link href="/register" target="_blank" rel="noopener noreferrer">Создать аккаунт</Link></p><p className="muted">После входа вернитесь на эту страницу и примите приглашение.</p><button className="button primary" disabled={!token||pending} onClick={()=>void accept()}>{pending?'Принимаем…':'Принять приглашение'}</button></>}{error?<p className="notice error" role="alert">{error}</p>:null}</section></main>;
}
