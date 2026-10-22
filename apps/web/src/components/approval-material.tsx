'use client';
import {useEffect,useRef,useState} from 'react';
import type {ScriptOutput,PostOutput,CarouselOutput} from '@contentos/types';
import {paintCarouselSlide} from '../lib/carousel-canvas';
type Material={entityType:'SCRIPT';content:ScriptOutput}|{entityType:'POST';content:PostOutput}|{entityType:'CAROUSEL';content:CarouselOutput};
function SlideReview({content}:{content:CarouselOutput}){
  const [index,setIndex]=useState(0),[error,setError]=useState(''),canvas=useRef<HTMLCanvasElement>(null);
  useEffect(()=>{try{if(canvas.current)paintCarouselSlide(canvas.current,content,index);setError('');}catch{setError('Не удалось показать слайд. Не одобряйте оформление без проверки.');}},[content,index]);
  return <><label>Слайд для просмотра<select value={index} onChange={event=>setIndex(Number(event.target.value))}>{content.slides.map((slide,i)=><option key={i} value={i}>{i+1}. {slide.heading}</option>)}</select></label>{error?<p role="alert">{error}</p>:null}<canvas ref={canvas} style={{maxWidth:'100%',height:'auto'}} aria-label={`Слайд ${index+1}`}/><ol>{content.slides.map((slide,i)=><li key={i}><h3>{slide.heading}</h3><p className="preserve-lines">{slide.body}</p></li>)}</ol></>;
}
export function ApprovalMaterial({value}:{value:Material}){
  return <details><summary>{value.entityType==='SCRIPT'?'Сценарий на согласовании':value.entityType==='POST'?'Пост на согласовании':'Карусель на согласовании'}</summary>
    {value.entityType==='SCRIPT'?(['hook','context','core','proof','cta'] as const).map(key=><p className="preserve-lines" key={key}><strong>{key.toUpperCase()}</strong><br/>{value.content[key]}</p>):value.entityType==='POST'?<><p className="preserve-lines">{value.content.body}</p><p>{value.content.hashtags.map(tag=>`#${tag}`).join(' ')}</p></>:<><SlideReview content={value.content}/><p className="preserve-lines">{value.content.caption}</p><p>{value.content.hashtags.map(tag=>`#${tag}`).join(' ')}</p></>}
    <p className="notice warning">{value.content.factCheckNotes.join(' · ')||'Проверьте утверждения перед одобрением.'}</p>
  </details>;
}
