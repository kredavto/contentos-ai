import {expect,it} from 'vitest';
import {unzipSync} from 'fflate';
import {buildCarouselArchive,maxCarouselPngBytes} from '../apps/web/src/lib/carousel-export';
import {carouselSchema} from '../packages/types/src/carousels';
const content=()=>carouselSchema.parse({title:'../PRIVATE-title',slides:[{heading:'First',body:'One'},{heading:'Second',body:'Two'}],caption:'Публичная подпись',hashtags:['учёба'],factCheckNotes:['PRIVATE-notes'],design:{format:'PORTRAIT',font:'SANS',backgroundColor:'#ffffff',textColor:'#000000',accentColor:'#112233'}});
const png=(index:number)=>new Uint8Array([137,80,78,71,13,10,26,10,index]);
it('exports ordered slides and UTF-8 publication text with no internal metadata or caller-controlled paths',async()=>{
  const progress:number[]=[],input=content();input.slides=Array.from({length:10},(_,i)=>({heading:`Slide ${i+1}`,body:'Text'}));
  const archive=await buildCarouselArchive(input,async(_,i)=>png(i),new AbortController().signal,done=>progress.push(done));
  const files=unzipSync(archive);
  expect(Object.keys(files)).toEqual([...Array.from({length:10},(_,i)=>`slide-${String(i+1).padStart(2,'0')}.png`),'caption.txt']);
  for(let i=0;i<10;i++)expect(files[`slide-${String(i+1).padStart(2,'0')}.png`]).toEqual(png(i));
  expect(new TextDecoder().decode(files['caption.txt'])).toBe('Публичная подпись\n\n#учёба');
  expect(new TextDecoder().decode(archive)).not.toContain('PRIVATE');expect(progress).toEqual([1,2,3,4,5,6,7,8,9,10]);
});
it('takes an immutable content snapshot and rejects a partially failed render',async()=>{
  const input=content();let calls=0;
  await expect(buildCarouselArchive(input,async(snapshot,i)=>{calls++;expect(snapshot.caption).toBe('Публичная подпись');input.caption='Changed';if(i===1)throw new Error('render failed');return png(i);},new AbortController().signal)).rejects.toThrow('render failed');expect(calls).toBe(2);
});
it('stops before or between slides when cancelled',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  await expect(buildCarouselArchive(content(),async()=>{calls++;return png(0);},controller.signal)).rejects.toThrow();expect(calls).toBe(0);
  const later=new AbortController();await expect(buildCarouselArchive(content(),async()=>{calls++;later.abort();return png(0);},later.signal)).rejects.toThrow();expect(calls).toBe(1);
});
it('rejects invalid PNG output and enforces per-slide and aggregate byte limits',async()=>{
  for(const bytes of [new Uint8Array(),new Uint8Array(12),new Uint8Array(maxCarouselPngBytes+1)])await expect(buildCarouselArchive(content(),async()=>bytes,new AbortController().signal)).rejects.toThrow();
  const input=content();input.slides=Array.from({length:10},()=>input.slides[0]!);
  const large=new Uint8Array(maxCarouselPngBytes);large.set(png(0));let calls=0;
  await expect(buildCarouselArchive(input,async()=>{calls++;return large;},new AbortController().signal)).rejects.toThrow('64');expect(calls).toBe(7);
});
