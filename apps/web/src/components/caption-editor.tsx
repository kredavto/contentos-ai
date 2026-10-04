'use client';
import {useState} from 'react';
import type {VideoService} from '@contentos/core';
import {captionSegmentsSchema,type CaptionSegment} from '@contentos/types';
import {api} from '../lib/api-client';
type Review=Awaited<ReturnType<VideoService['captionReview']>>;
export function CaptionEditor({base,initial,onDone}:{base:string;initial:Review;onDone:()=>void}){
  const [segments,setSegments]=useState(initial.track.segments),[style,setStyle]=useState(initial.track.style),[revision,setRevision]=useState(initial.track.revision);
  const [dirty,setDirty]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const valid=captionSegmentsSchema.safeParse(segments).success&&segments.every(segment=>segment.end<=initial.durationSeconds+.05);
  function change(index:number,patch:Partial<CaptionSegment>){setSegments(rows=>rows.map((row,i)=>i===index?{...row,...patch}:row));setDirty(true);setNotice('');}
  async function save(confirm=false){setPending(true);setError('');try{
    if(confirm){await api(`${base}/confirm`,'POST',{revision});onDone();}
    else{const result=await api<{revision:number}>(base,'PUT',{revision,segments,style});setRevision(result.revision);setDirty(false);setNotice('Субтитры сохранены');}
  }catch(failure){setError(failure instanceof Error?failure.message:'Не удалось сохранить субтитры');}finally{setPending(false);}}
  return <section className="stack" aria-label="Редактор субтитров"><h3>Проверьте субтитры</h3><p className="muted">Исправьте текст и время появления. Сохраните изменения, затем запустите финальный рендер. Длительность: {initial.durationSeconds.toFixed(1)} сек.</p>
    <video className="video-preview" aria-label="Исходное видео" src={initial.videoUrl} controls preload="metadata"/>
    {error?<p className="notice error" role="alert">{error}</p>:null}{notice?<p role="status">{notice}</p>:null}
    <fieldset disabled={pending||!initial.editable}><label>Стиль субтитров<select aria-label="Стиль субтитров" value={style} onChange={event=>{setStyle(event.target.value as typeof style);setDirty(true);}}><option value="clean">Лаконичный</option><option value="bold">Акцентный</option></select></label>
    {segments.map((segment,index)=><div className="stack" key={index}><div className="studio-form"><label>Начало, сек.<input aria-label={`Начало ${index+1}`} type="number" min="0" max={initial.durationSeconds} step="0.01" value={Number.isFinite(segment.start)?segment.start:''} onChange={event=>change(index,{start:event.target.valueAsNumber})}/></label><label>Конец, сек.<input aria-label={`Конец ${index+1}`} type="number" min="0" max={initial.durationSeconds} step="0.01" value={Number.isFinite(segment.end)?segment.end:''} onChange={event=>change(index,{end:event.target.valueAsNumber})}/></label></div><label>Текст<textarea aria-label={`Субтитр ${index+1}`} maxLength={500} value={segment.text} onChange={event=>change(index,{text:event.target.value})}/></label><button type="button" className="text-button" onClick={()=>{setSegments(rows=>rows.filter((_,i)=>i!==index));setDirty(true);}}>Удалить фрагмент {index+1}</button></div>)}
    <button type="button" className="button secondary" disabled={segments.length>=300||(segments.at(-1)?.end??0)>=initial.durationSeconds} onClick={()=>{const start=segments.at(-1)?.end??0;setSegments([...segments,{start,end:Math.min(initial.durationSeconds,start+2),text:''}]);setDirty(true);}}>Добавить фрагмент</button></fieldset>
    {!valid?<p className="notice warning">Заполните текст. Время начала должно быть меньше конца; фрагменты не должны пересекаться или выходить за длительность видео.</p>:null}
    <div className="studio-actions"><button className="button secondary" disabled={pending||!initial.editable||!dirty||!valid} onClick={()=>void save()}>Сохранить субтитры</button><button className="button primary" disabled={pending||!initial.editable||dirty||!valid} onClick={()=>void save(true)}>Запустить финальный рендер</button><button className="text-button" disabled={pending} onClick={onDone}>Закрыть редактор</button></div>
  </section>;
}
