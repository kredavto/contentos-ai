import {zipSync} from 'fflate';
import {carouselSchema,carouselPublicationText,type CarouselOutput} from '@contentos/types';
import {paintCarouselSlide} from './carousel-canvas';
export const maxCarouselPngBytes=10*1024*1024,maxCarouselArchiveBytes=64*1024*1024;
const pngSignature=[137,80,78,71,13,10,26,10];
export type CarouselSlideRenderer=(content:CarouselOutput,index:number,signal:AbortSignal)=>Promise<Uint8Array>;
export const renderCarouselPng:CarouselSlideRenderer=async(content,index,signal)=>{
  signal.throwIfAborted();const canvas=document.createElement('canvas');
  try{
    paintCarouselSlide(canvas,content,index);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Не удалось создать PNG')),'image/png'));
    signal.throwIfAborted();if(blob.size>maxCarouselPngBytes)throw new Error('Слайд превышает лимит 10 МиБ');
    return new Uint8Array(await blob.arrayBuffer());
  }finally{canvas.width=0;canvas.height=0;}
};
/** Fixed file names only; internal title and fact-check notes are never serialized. */
export async function buildCarouselArchive(raw:CarouselOutput,render:CarouselSlideRenderer,signal:AbortSignal,onProgress:(done:number,total:number)=>void=()=>{}){
  const content=carouselSchema.parse(raw),files:Record<string,Uint8Array>={};
  const caption=new TextEncoder().encode(carouselPublicationText(content));let total=caption.byteLength;
  for(let index=0;index<content.slides.length;index++){
    signal.throwIfAborted();await new Promise<void>(resolve=>setTimeout(resolve,0));signal.throwIfAborted();
    const png=await render(content,index,signal);signal.throwIfAborted();
    if(png.byteLength>maxCarouselPngBytes||!pngSignature.every((byte,i)=>png[i]===byte))throw new Error('Не удалось подготовить PNG в пределах 10 МиБ');
    total+=png.byteLength;if(total>maxCarouselArchiveBytes-4096)throw new Error('Архив превышает лимит 64 МиБ');
    files[`slide-${String(index+1).padStart(2,'0')}.png`]=png;onProgress(index+1,content.slides.length);
  }
  files['caption.txt']=caption;signal.throwIfAborted();
  // PNG is already compressed. Store entries without recompression or worker scripts.
  const archive=zipSync(files,{level:0,mtime:new Date(1980,0,1)});
  if(archive.byteLength>maxCarouselArchiveBytes)throw new Error('Архив превышает лимит 64 МиБ');
  signal.throwIfAborted();return archive;
}
