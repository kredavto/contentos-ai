'use client';
import {useState} from 'react';
import {api} from '../lib/api-client';
export function CommentDeliveryResolution({ready,onResolved}:{ready:boolean;onResolved:()=>void}){
 const [tenantId,setTenantId]=useState(''),[deliveryId,setDeliveryId]=useState(''),[attemptId,setAttemptId]=useState(''),[externalCommentId,setExternalCommentId]=useState(''),[ticket,setTicket]=useState(''),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 async function resolve(){setPending(true);setError('');setMessage('');try{await api('admin/comment-delivery-resolution','POST',{tenantId,deliveryId,attemptId,externalCommentId,ticket,confirmAttemptEvidence:confirmed});setMessage('Квитанция проверена, публикация ответа подтверждена.');setConfirmed(false);onResolved();}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось проверить квитанцию');}finally{setPending(false);}}
 return <section className="panel stack" aria-label="Сверка ответа YouTube"><h3>Подтвердить опубликованный ответ</h3><p>Укажите ID ответа из подтверждённых материалов расследования этой попытки. Будут проверены канал, родительский комментарий, точный текст и время публикации. Совпадения текста недостаточно. Сверка не отправляет ответ повторно.</p>
  {!ready?<p>Для проверки требуется настроенное подключение YouTube на сервере.</p>:null}
  <label>Организация<input value={tenantId} onChange={event=>setTenantId(event.target.value)} disabled={pending}/></label>
  <label>Заявка доставки<input value={deliveryId} onChange={event=>setDeliveryId(event.target.value)} disabled={pending}/></label>
  <label>ID сохранённой попытки<input value={attemptId} onChange={event=>setAttemptId(event.target.value)} disabled={pending}/></label>
  <label>ID опубликованного ответа YouTube<input value={externalCommentId} maxLength={200} onChange={event=>setExternalCommentId(event.target.value)} disabled={pending}/></label>
  <label>Обращение / материалы расследования<input value={ticket} maxLength={200} onChange={event=>setTicket(event.target.value)} disabled={pending}/></label>
  <label><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)} disabled={pending}/>Подтверждаю связь квитанции с указанной попыткой по материалам расследования</label>
  {error?<p role="alert">{error}</p>:null}{message?<p role="status">{message}</p>:null}
  <button className="button primary" disabled={pending||!ready||!confirmed||!tenantId||!deliveryId||!attemptId||!externalCommentId||ticket.trim().length<5} onClick={()=>void resolve()}>Проверить квитанцию ответа</button>
 </section>;
}
