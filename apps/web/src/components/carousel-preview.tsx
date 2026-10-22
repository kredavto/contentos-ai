'use client';
import {useEffect,useRef,useState} from 'react';
import type {CarouselOutput} from '@contentos/types';
import {paintCarouselSlide} from '../lib/carousel-canvas';
export function CarouselPreview({content,index,exportName,archiveName,canExport,verifyExport}:{content:CarouselOutput;index:number;exportName:string;archiveName:string;canExport:boolean;verifyExport:(signal:AbortSignal)=>Promise<void>}){
  const canvas=useRef<HTMLCanvasElement>(null),controller=useRef<AbortController|null>(null);
  const [error,setError]=useState(''),[previewError,setPreviewError]=useState(''),[pending,setPending]=useState(false),[progress,setProgress]=useState('');
  const identity=JSON.stringify([content,exportName,canExport]);
  useEffect(()=>()=>controller.current?.abort(),[identity]);
  useEffect(()=>{try{if(canvas.current)paintCarouselSlide(canvas.current,content,index);setPreviewError('');}catch{if(canvas.current)canvas.current.getContext('2d')?.clearRect(0,0,canvas.current.width,canvas.current.height);setPreviewError('Заполните слайды и проверьте длину текста для предпросмотра.');}},[content,index]);
  async function download(all:boolean){
    if(!canExport||controller.current)return;
    const active=new AbortController();controller.current=active;setPending(true);setError('');setProgress('Проверяем одобрение…');
    try{
      await verifyExport(active.signal);active.signal.throwIfAborted();
      const {buildCarouselArchive,renderCarouselPng}=await import('../lib/carousel-export');active.signal.throwIfAborted();
      const bytes=all?await buildCarouselArchive(content,renderCarouselPng,active.signal,(done,total)=>setProgress(`Подготовлено слайдов: ${done} из ${total}`)):await renderCarouselPng(content,index,active.signal);
      active.signal.throwIfAborted();setProgress('Завершаем подготовку…');await verifyExport(active.signal);active.signal.throwIfAborted();
      const blob=new Blob([new Uint8Array(bytes)],{type:all?'application/zip':'image/png'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      try{link.href=url;link.download=all?archiveName:exportName;document.body.append(link);link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
      setProgress('Файл подготовлен для скачивания');
    }catch(failure){if(active.signal.aborted)setProgress('Экспорт отменён');else{setProgress('');setError(failure instanceof Error?failure.message:'Не удалось скачать файлы');}}
    finally{if(controller.current===active)controller.current=null;setPending(false);}
  }
  return <div className="stack"><canvas ref={canvas} aria-label={`Предпросмотр слайда ${index+1}`} style={{width:'100%',maxWidth:430,height:'auto',borderRadius:12}}/>{previewError||error?<p className="notice error" role="alert">{previewError||error}</p>:null}
    {progress?<p role="status">{progress}</p>:null}
    <button className="button secondary" disabled={!canExport||pending||!!previewError} onClick={()=>void download(false)}>Скачать слайд {index+1} PNG</button>
    <button className="button secondary" disabled={!canExport||pending||!!previewError} onClick={()=>void download(true)}>Скачать карусель ZIP</button>
    {pending?<button className="text-button" onClick={()=>controller.current?.abort()}>Отменить экспорт</button>:null}
  </div>;
}
