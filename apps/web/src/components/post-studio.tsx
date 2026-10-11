'use client';
import { useRef, useState } from 'react';
import type { GenerationService } from '@contentos/core';
import { postPublicationText, type PostOutput, type GenerationOptions } from '@contentos/types';
import { api } from '../lib/api-client';
type Post=Awaited<ReturnType<GenerationService['overview']>>['posts'][number];
export type PostPlanDraft={title:string;body:string;hashtags:string[];platform:GenerationOptions['platform']};
export function PostStudio({base,posts,canWrite,canApprove,ready,cost,onRefresh,onPlan}:{base:string;posts:Post[];canWrite:boolean;canApprove:boolean;ready:boolean;cost:number|undefined;onRefresh:()=>Promise<void>;onPlan:(post:PostPlanDraft)=>void}){
  const [topic,setTopic]=useState(''),[platform,setPlatform]=useState<GenerationOptions['platform']>('TELEGRAM');
  const [selected,setSelected]=useState<Post|null>(null),[draft,setDraft]=useState<PostOutput|null>(null),[tags,setTags]=useState('');
  const [history,setHistory]=useState<Array<{version:number;content:PostOutput}>>([]),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const intent=useRef<{payload:string;key:string}|null>(null);
  function choose(post:Post){setSelected(post);setDraft(post.content);setTags(post.content.hashtags.join(' '));setHistory([]);setNotice('');}
  const content=draft?{...draft,hashtags:tags.split(/[\s,]+/u).map(tag=>tag.replace(/^#/, '')).filter(Boolean)}:null;
  const dirty=!!selected&&JSON.stringify(content)!==JSON.stringify(selected.content);
  const stale=!!selected&&posts.find(post=>post.id===selected.id)?.currentVersion!==selected.currentVersion;
  async function perform(action:()=>Promise<void>){setPending(true);setError('');setNotice('');try{await action();await onRefresh();}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось выполнить действие');}finally{setPending(false);}}
  async function save(approve:boolean){if(!selected||!content)return;await api(`${base}/posts/${selected.id}`,'PUT',{revision:selected.currentVersion,content:approve?null:content});const overview=await api<Awaited<ReturnType<GenerationService['overview']>>>(`${base}/content`);const post=overview.posts.find(post=>post.id===selected.id);if(post)choose(post);setNotice(approve?'Версия поста одобрена':'Новая версия сохранена');}
  return <section className="stack post-studio"><h2>Студия постов</h2>
    <p>Сгенерируйте пост, проверьте факты и отредактируйте текст. Одобрение не публикует материал.</p>
    {error?<p role="alert" className="notice error">{error}</p>:null}{notice?<p role="status" className="notice">{notice}</p>:null}
    <form className="panel stack" onSubmit={event=>{event.preventDefault();void perform(async()=>{const options={topic,platform};const payload=JSON.stringify(options);if(intent.current?.payload!==payload)intent.current={payload,key:crypto.randomUUID()};await api(`${base}/jobs`,'POST',{type:'GENERATE_POST',options,idempotencyKey:intent.current.key});intent.current=null;setNotice('Пост генерируется. Он появится в списке после завершения задачи.');});}}>
      <label htmlFor="post-topic">Тема поста</label><input id="post-topic" required maxLength={2000} value={topic} onChange={e=>setTopic(e.target.value)} disabled={!canWrite||pending}/>
      <label htmlFor="post-platform">Площадка поста</label><select id="post-platform" value={platform} onChange={e=>setPlatform(e.target.value as GenerationOptions['platform'])} disabled={!canWrite||pending}>{['TELEGRAM','YOUTUBE','TIKTOK','INSTAGRAM','VK'].map(value=><option key={value}>{value}</option>)}</select>
      <button className="button primary" disabled={!canWrite||pending||!ready||!cost}>Создать пост · {cost??'—'} кр.</button>
    </form>
    <label htmlFor="post-selection">Сохранённый пост</label><select id="post-selection" value={selected?.id??''} onChange={e=>{const post=posts.find(post=>post.id===e.target.value);if(post)choose(post);else{setSelected(null);setDraft(null);}}}><option value="">Выберите пост</option>{posts.map(post=><option key={post.id} value={post.id}>{post.content.title} · v{post.currentVersion}</option>)}</select>
    {!posts.length?<p>Постов пока нет. Статус генерации доступен во вкладке «Задачи».</p>:null}
    {selected&&draft&&content?<article className="panel stack"><h3>Пост v{selected.currentVersion}{selected.approvedVersion===selected.currentVersion?' · Одобрен':''}</h3>
      {stale?<p className="notice warning">Пост изменён в другом окне. Выберите его заново перед сохранением.</p>:null}
      <label htmlFor="post-title">Рабочее название</label><input id="post-title" maxLength={200} value={draft.title} readOnly={!canWrite} onChange={e=>setDraft({...draft,title:e.target.value})}/>
      <label htmlFor="post-body">Текст поста</label><textarea id="post-body" rows={10} maxLength={16000} value={draft.body} readOnly={!canWrite} onChange={e=>setDraft({...draft,body:e.target.value})}/>
      <label htmlFor="post-tags">Хештеги поста</label><input id="post-tags" maxLength={3030} value={tags} readOnly={!canWrite} onChange={e=>setTags(e.target.value)}/>
      <p className="notice warning">Проверьте факты перед публикацией. {draft.factCheckNotes.join(' · ')}</p>
      <div className="studio-actions"><button className="button secondary" disabled={!canWrite||pending||stale||!dirty} onClick={()=>void perform(()=>save(false))}>Сохранить версию поста</button><button className="button primary" disabled={!canApprove||pending||dirty||stale||selected.approvedVersion===selected.currentVersion} onClick={()=>void perform(()=>save(true))}>Одобрить пост</button><button className="button secondary" disabled={!canWrite||pending||dirty||stale||selected.approvedVersion!==selected.currentVersion} onClick={()=>onPlan({...selected.content,platform:selected.platform as GenerationOptions['platform']})}>Создать план из поста</button><button className="button secondary" disabled={pending} onClick={()=>void perform(async()=>{setHistory(await api(`${base}/posts/${selected.id}`));})}>История поста</button></div>
      <label htmlFor="post-copy">Текст для копирования</label><textarea id="post-copy" readOnly rows={5} value={postPublicationText(content)}/>
      <small>Рабочее название и заметки о проверке фактов не включаются в публикацию. Лимиты площадки проверяются перед отправкой.</small>
      {history.map(version=><details key={version.version}><summary>Пост: версия {version.version}</summary><h4>{version.content.title}</h4><p className="preserve-lines">{postPublicationText(version.content)}</p></details>)}
      {history.length===100?<small>Показаны последние 100 версий.</small>:null}
    </article>:null}
    <small>Показаны последние 100 постов бренда.</small>
  </section>;
}
