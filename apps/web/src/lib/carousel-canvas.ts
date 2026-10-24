import {carouselSchema,type CarouselOutput} from '@contentos/types';
/** Browser-local deterministic typography. No URLs, HTML, SVG or remote fonts. */
export function paintCarouselSlide(canvas:HTMLCanvasElement,raw:CarouselOutput,index:number){
  const content=carouselSchema.parse(raw),slide=content.slides[index];if(!slide)throw new Error('Слайд не найден');
  canvas.width=1080;canvas.height=content.design.format==='SQUARE'?1080:1350;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Браузер не поддерживает создание PNG');
  const width=canvas.width,height=canvas.height,margin=72,lineWidth=width-margin*2;
  const family=content.design.font==='SERIF'?'Georgia, serif':'Arial, sans-serif';
  function lines(text:string){const result:string[]=[];let current='';for(const word of text.trim().split(/\s+/u)){
    if(current&&ctx!.measureText(`${current} ${word}`).width>lineWidth){result.push(current);current='';}
    for(const character of Array.from(word)){if(ctx!.measureText(current+character).width>lineWidth){result.push(current);current='';}current+=character;}
    current+=' ';
  }if(current.trim())result.push(current.trim());return result;}
  function fit(text:string,bold:boolean,maxSize:number,minSize:number,space:number){for(let size=maxSize;size>=minSize;size-=2){ctx!.font=`${bold?'700':'400'} ${size}px ${family}`;const wrapped=lines(text),step=Math.ceil(size*1.3);if(wrapped.length*step<=space)return {wrapped,size,step,height:wrapped.length*step};}throw new Error('Текст не помещается на слайде. Сократите заголовок или основной текст.');}
  const heading=fit(slide.heading,true,72,32,Math.floor(height*.25));
  const bodyY=140+heading.height+36,body=fit(slide.body,false,44,24,height-bodyY-110);
  ctx.fillStyle=content.design.backgroundColor;ctx.fillRect(0,0,width,height);
  ctx.fillStyle=content.design.accentColor;ctx.fillRect(margin,80,84,10);
  ctx.fillStyle=content.design.textColor;ctx.textBaseline='top';
  ctx.font=`700 ${heading.size}px ${family}`;heading.wrapped.forEach((line,i)=>ctx.fillText(line.trim(),margin,140+i*heading.step));
  ctx.font=`400 ${body.size}px ${family}`;body.wrapped.forEach((line,i)=>ctx.fillText(line.trim(),margin,bodyY+i*body.step));
  ctx.font=`400 26px ${family}`;ctx.fillText(`${index+1} / ${content.slides.length}`,margin,height-62);
  return {width,height};
}
