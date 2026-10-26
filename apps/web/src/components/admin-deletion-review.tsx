'use client';
import {useState} from 'react';
import type {AdminService} from '@contentos/core';
import {api} from '../lib/api-client';
type Inspection=Awaited<ReturnType<AdminService['inspectDeletion']>>;
const labels:Record<keyof Inspection['inventory'],string>={
 memberships:'Участие в организациях',ownedOrganizations:'Организации во владении',activeSessions:'Активные сессии',
 pendingGenerationJobs:'Незавершённые задачи генерации',generationReconciliation:'Из них требуют сверки',photoUploads:'Загруженные фотографии, ещё не удалённые',libraryUploads:'Загруженные аудио и видео, ещё не удалённые',
 socialConnectionsCreated:'Созданные социальные подключения, ещё не отозванные',providerKeysCreated:'Созданные подключения BYOK, ещё активные',consentEvidence:'Записи принятых согласий',renewalEvidence:'Записи согласий на автопродление',pendingAuthEmails:'Незавершённые служебные письма',pendingNotificationEmails:'Незавершённые почтовые уведомления',
};
export function AdminDeletionReview({requestIds}:{requestIds:string[]}){
 const [id,setId]=useState(''),[data,setData]=useState<Inspection|null>(null),[pending,setPending]=useState(false),[error,setError]=useState('');
 async function inspect(){setPending(true);setData(null);setError('');try{setData(await api<Inspection>(`admin/deletion-requests/${id}`));}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось проверить зависимости');}finally{setPending(false);}}
 return <section className="panel brand-profile-editor" aria-label="Проверка запроса удаления"><h2>Зависимости удаления аккаунта</h2>
  <p>Проверка показывает связи с пользователем на момент запроса. Она не запускает удаление, не блокирует аккаунт и не отменяет задания.</p>
  <form onSubmit={event=>{event.preventDefault();if(id)void inspect();}}><label>Запрос для проверки<select aria-label="Запрос для проверки" value={id} disabled={pending} onChange={event=>{setId(event.target.value);setData(null);setError('');}}><option value="">Выберите запрос на текущей странице</option>{requestIds.map(request=><option key={request} value={request}>{request}</option>)}</select></label><button className="button secondary" disabled={pending||!id}>{pending?'Проверяем…':'Проверить зависимости'}</button></form>
  {error?<p role="alert">{error}</p>:null}
  {data?<><p role="status">Проверка выполнена. Запрос {data.request.status==='REQUESTED'?'ожидает обработки':'отменён'}.</p><p>Пользователь: {data.request.userId}</p><p className="muted">Снимок: {new Date(data.inspectedAt).toLocaleString('ru-RU')}</p>
   {data.request.status==='CANCELLED'?<p className="notice warning">Запрос отменён пользователем. Этот отчёт не разрешает обработку или удаление.</p>:null}
   {data.inventory.ownedOrganizations!=='0'?<p className="notice warning">Сначала требуется решить вопрос владения организациями. Удаление аккаунта не должно оставлять организацию без владельца.</p>:null}
   <dl>{(Object.keys(labels) as Array<keyof typeof labels>).map(key=><div className="summary-row" key={key}><dt>{labels[key]}</dt><dd>{data.inventory[key]}</dd></div>)}</dl>
   {data.execution?<p role="status">Отдельная операция удаления профиля и данных входа: {data.execution.status==='COMPLETED'?'выполнена':data.execution.status==='BLOCKED'?'требует ручной проверки':'в очереди'} · ID {data.execution.id}</p>:null}
   <p className="notice warning">Автор загрузки или согласия не обязательно является человеком на фото или владельцем ресурса. Подключение могло перейти другому владельцу. Сначала нужно определить состав удаляемых данных и проверить внешние операции.</p>
   <p>Нулевые счётчики не подтверждают отсутствие всех персональных данных: содержимое материалов, образы и голоса, публикации и платёжные документы требуют отдельной проверки. Этот экран не разрешает стирание. Подтверждение удаления профиля и данных входа выполняет сам пользователь отдельным действием.</p>
  </>:null}
 </section>;
}
