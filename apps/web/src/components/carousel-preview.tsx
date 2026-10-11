'use client';
import {useEffect,useRef,useState} from 'react';
import type {CarouselOutput} from '@contentos/types';
import {paintCarouselSlide} from '../lib/carousel-canvas';
export function CarouselPreview({content,index,exportName,canExport}:{content:CarouselOutput;index:number;exportName:string;canExport:boolean}){
  const canvas=useRef<HTMLCanvasElement>(null),[error,setError]=useState(''),[pending,setPending]=useState(false);
  useEffect(()=>{try{if(canvas.current)paintCarouselSlide(canvas.current,content,index);setError('');}catch{if(canvas.current)canvas.current.getContext('2d')?.clearRect(0,0,canvas.current.width,canvas.current.height);setError('Заполните слайды и проверьте длину текста для предпросмотра.');}},[content,index]);
  async function download(){if(!canvas.current||!canExport)return;setPending(true);setError('');try{paintCarouselSlide(canvas.current,content,index);const blob=await new Promise<Blob>((resolve,reject)=>canvas.current!.toBlob(value=>value?resolve(value):reject(new Error('Не удалось создать PNG')),'image/png'));const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=exportName;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}catch(failure){setError(failure instanceof Error?failure.message:'Не удалось скачать PNG');}finally{setPending(false);}}
  return <div className="stack"><canvas ref={canvas} aria-label={`Предпросмотр слайда ${index+1}`} style={{width:'100%',maxWidth:430,height:'auto',borderRadius:12}}/>{error?<p className="notice error" role="alert">{error}</p>:null}<button className="button secondary" disabled={!canExport||pending||!!error} onClick={()=>void download()}>Скачать слайд {index+1} PNG</button></div>;
}
