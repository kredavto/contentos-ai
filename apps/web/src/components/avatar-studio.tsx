'use client';
import {useEffect,useRef,useState} from 'react';
import type {AvatarService,ConsentService,MediaService} from '@contentos/core';
import {api} from '../lib/api-client';
type Overview=Awaited<ReturnType<AvatarService['overview']>>;
type Sources={media:Awaited<ReturnType<MediaService['overview']>>;consents:Awaited<ReturnType<ConsentService['overview']>>};
const labels={QUEUED:'В очереди',PROCESSING:'Обрабатывается',READY:'Готово',FAILED:'Ошибка',RECONCILIATION:'Требуется проверка'};
export function AvatarStudio({base,canWrite,canManage,cost}:{base:string;canWrite:boolean;canManage:boolean;cost?:number}){
  const [data,setData]=useState<Overview|null>(null),[sources,setSources]=useState<Sources|null>(null);
  const [name,setName]=useState(''),[subjectId,setSubjectId]=useState(''),[sourceAssetId,setSourceAssetId]=useState(''),[avatarId,setAvatarId]=useState('');
  const [likenessType,setLikenessType]=useState<'OWN_LIKENESS'|'THIRD_PARTY_LIKENESS'>('OWN_LIKENESS');
  const [pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const intent=useRef<{payload:string;key:string}|null>(null);
  useEffect(()=>{
    let active=true;let timer:ReturnType<typeof setTimeout>;
    async function poll(){try{
      const [overview,media,consents]=await Promise.all([api<Overview>(`${base}/avatars`),api<Sources['media']>(`${base}/media`),api<Sources['consents']>(`${base}/consents`)]);
      if(active){setData(overview);setSources({media,consents});}
    }catch(failure){if(active)setError(failure instanceof Error?failure.message:'Не удалось загрузить аватары');}
    finally{if(active)timer=setTimeout(()=>void poll(),5000);}}
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[base]);
  async function perform(action:()=>Promise<void>){setPending(true);setError('');setNotice('');try{await action();setData(await api<Overview>(`${base}/avatars`));}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось выполнить действие');}finally{setPending(false);}}
  const consentReady=[likenessType,'CROSS_BORDER_PROCESSING'].every(type=>{
    const policy=sources?.consents.policies.find(item=>item.type===type);
    return policy&&sources?.consents.records.some(record=>record.subjectId===subjectId&&record.type===type&&!record.revokedAt&&record.version===policy.version&&record.textHash===policy.textHash);
  });
  const eligible=data?.looks.filter(look=>look.avatarStatus==='ACTIVE'&&look.status==='READY'&&look.consentValid&&look.subjectId===subjectId)??[];
  const groups=eligible.filter((look,index)=>eligible.findIndex(other=>other.avatarId===look.avatarId)===index);
  return <section><h2>Студия аватаров</h2><p className="muted">Создайте аватар по фотографии или добавьте образ существующему аватару.</p>
    {error?<p className="notice error" role="alert">{error}</p>:null}{notice?<p className="notice success" role="status">{notice}</p>:null}
    {!data?<p role="status">Загружаем аватары…</p>:null}
    {data?.configuration.provider==='mock-avatar'?<p className="notice warning">ДЕМО: проверяется работа очереди. Настоящий аватар не создаётся.</p>:null}
    {data&&!data.configuration.ready?<p className="notice warning">Создание аватаров ещё не подключено. Администратор должен настроить HeyGen и хранилище.</p>:null}
    {canWrite?<form className="panel stack" onSubmit={event=>{event.preventDefault();void perform(async()=>{
      const payload=JSON.stringify({name,subjectId,sourceAssetId,likenessType,...(avatarId?{avatarId}:{})});
      if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};
      await api(`${base}/avatars`,'POST',{...JSON.parse(payload),idempotencyKey:intent.current.key});intent.current=null;setNotice('Задача добавлена в очередь');
    });}}>
      <label>Название образа<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label>
      <label>Человек на фотографии<select aria-label="Человек на фотографии" required value={subjectId} onChange={event=>{setSubjectId(event.target.value);setAvatarId('');}}><option value="">Выберите человека</option>{sources?.consents.subjects.filter(subject=>subject.type==='PERSON').map(subject=><option value={subject.id} key={subject.id}>{subject.name}</option>)}</select></label>
      <label>Права на изображение<select aria-label="Права на изображение" value={likenessType} onChange={event=>setLikenessType(event.target.value as typeof likenessType)}><option value="OWN_LIKENESS">Моё изображение</option><option value="THIRD_PARTY_LIKENESS">Изображение другого человека</option></select></label>
      <label>Исходная фотография<select aria-label="Исходная фотография" required value={sourceAssetId} onChange={event=>setSourceAssetId(event.target.value)}><option value="">Выберите фотографию из медиатеки</option>{sources?.media.assets.filter(asset=>asset.status==='READY').map(asset=><option value={asset.id} key={asset.id}>{asset.name}</option>)}</select></label>
      <label>Аватар<select aria-label="Аватар" value={avatarId} onChange={event=>setAvatarId(event.target.value)}><option value="">Создать новый аватар</option>{groups.map(look=><option value={look.avatarId} key={look.avatarId}>{look.avatarName} — добавить образ</option>)}</select></label>
      {!consentReady?<p className="notice warning">В разделе «Согласия» добавьте человека и подтвердите права на его изображение и обработку во внешнем AI-сервисе.</p>:null}
      <button className="button primary" disabled={pending||!data?.configuration.ready||!consentReady||!sourceAssetId||!name.trim()||cost===undefined}>Создать образ · {cost??'—'} кр.</button>
    </form>:null}
    {data&&!data.looks.length?<div className="panel empty">Здесь появятся ваши аватары и их образы.</div>:null}
    <div className="plan-grid">{data?.looks.map(look=><article className="panel stack" key={look.id}>
      <span className="badge">{look.avatarStatus==='DELETE_PENDING'?'Удаляется':labels[look.status]}</span><h3>{look.name}</h3><small>{look.avatarName}</small>
      {!look.consentValid?<p className="notice warning">Согласие отозвано или устарело. Использование этого образа заблокировано.</p>:null}
      {look.status==='FAILED'&&look.avatarStatus==='ACTIVE'?<p className="notice error">Создать образ не удалось. Зарезервированные кредиты возвращены.</p>:null}
      {look.status==='RECONCILIATION'?<p className="notice warning">Результат запроса требует проверки. Кредиты остаются зарезервированы. Не создавайте дубликат; обратитесь к администратору, если повторная проверка недоступна.</p>:null}
      {look.avatarStatus==='DELETE_PENDING'?<p className="muted">Удаление завершится после ответа внешнего сервиса. Если исход создания неизвестен, потребуется проверка администратором.</p>:<div className="studio-actions">
        {look.status==='RECONCILIATION'&&canManage?<button className="button secondary" disabled={pending||!look.consentValid} onClick={()=>void perform(async()=>{await api(`${base}/avatar-jobs/${look.jobId}/resume`,'POST');setNotice('Проверка возобновлена');})}>Повторить проверку</button>:null}
        {canWrite?<button className="text-button" disabled={pending} onClick={()=>void perform(async()=>{await api(`${base}/avatars/${look.avatarId}/delete`,'POST');setNotice('Аватар и все его образы поставлены на удаление');})}>Удалить аватар и все образы</button>:null}
      </div>}
    </article>)}</div>
  </section>;
}
