'use client';
import {brollSelectionsSchema,maxBrollClips,maxBrollTotalBytes} from '@contentos/types';
export type BrollDraft={key:string;assetId:string;start:string;end:string;sourceStart:string;approved:boolean;fade:boolean;fadeDuration:string};
type Asset={id:string;name:string;durationMs:number|null;bytes:number|null};
export function selectedBrollClips(drafts:BrollDraft[],assets:Asset[],maximumMs:number){
  if(!drafts.length)return [];
  const parsed=brollSelectionsSchema.safeParse(drafts.map(value=>({...(value.fade?{fadeMs:Number(value.fadeDuration)*1000}:{}),assetId:value.assetId,startMs:Number(value.start)*1000,endMs:Number(value.end)*1000,sourceStartMs:Number(value.sourceStart)*1000,approved:value.approved})));
  if(!parsed.success||drafts.some(value=>!value.start||!value.end||!value.sourceStart||value.fade&&!value.fadeDuration))return undefined;
  let totalBytes=0;
  for(const clip of parsed.data){
    const asset=assets.find(item=>item.id===clip.assetId);
    if(!asset||clip.sourceStartMs+clip.endMs-clip.startMs>(asset.durationMs??0)||clip.endMs>maximumMs)return undefined;
    totalBytes+=asset.bytes??0;
  }
  return totalBytes<=maxBrollTotalBytes?parsed.data:undefined;
}
export function VideoBrollControls({value,assets,maximumMs,disabled,onChange}:{value:BrollDraft[];assets:Asset[];maximumMs:number;disabled:boolean;onChange:(value:BrollDraft[])=>void}){
  const update=(index:number,patch:Partial<BrollDraft>)=>onChange(value.map((item,i)=>i===index?{...item,approved:false,...patch}:item));
  return <fieldset className="stack" disabled={disabled}><legend>B-roll — видеовставки</legend>
    {value.map((clip,index)=><fieldset className="stack" key={clip.key}><legend>Вставка {index+1}</legend>
      <label>Видео из медиатеки<select aria-label="B-roll из медиатеки" value={clip.assetId} onChange={event=>update(index,{assetId:event.target.value})}>
        <option value="">Выберите видео</option>
        {clip.assetId&&!assets.some(asset=>asset.id===clip.assetId)?<option value={clip.assetId}>Выбранный файл недоступен</option>:null}
        {assets.map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}
      </select></label>
      {clip.assetId?<p className="muted">Длительность исходника: {((assets.find(asset=>asset.id===clip.assetId)?.durationMs??0)/1000).toFixed(1)} сек.</p>:null}
      <label>Начало вставки, сек.<input type="number" min="0" max="179.9" step="0.1" required value={clip.start} onChange={event=>update(index,{start:event.target.value})}/></label>
      <label>Конец вставки, сек.<input type="number" min="0.1" max="180" step="0.1" required value={clip.end} onChange={event=>update(index,{end:event.target.value})}/></label>
      <label>Начало фрагмента в исходнике, сек.<input type="number" min="0" max="179.9" step="0.1" required value={clip.sourceStart} onChange={event=>update(index,{sourceStart:event.target.value})}/></label>
      <label><input type="checkbox" checked={clip.fade} onChange={event=>update(index,{fade:event.target.checked})}/>Плавное появление и исчезновение</label>
      {clip.fade?<label>Длительность каждого перехода, сек.<input type="number" min="0.1" max="2" step="0.1" required value={clip.fadeDuration} onChange={event=>update(index,{fadeDuration:event.target.value})}/></label>:null}
      <label><input type="checkbox" checked={clip.approved} onChange={event=>update(index,{approved:event.target.checked})}/>Подтверждаю выбранную вставку и её интервал</label>
      <button type="button" className="button secondary" onClick={()=>onChange(value.filter((_,i)=>i!==index))}>Удалить вставку {index+1}</button>
    </fieldset>)}
    <button type="button" className="button secondary" disabled={value.length>=maxBrollClips} onClick={()=>onChange([...value,{key:crypto.randomUUID(),assetId:'',start:value.at(-1)?.end??'0',end:String(Number(value.at(-1)?.end??0)+1),sourceStart:'0',approved:false,fade:false,fadeDuration:'0.1'}])}>Добавить B-roll</button>
    {selectedBrollClips(value,assets,maximumMs)===undefined?<p className="notice warning">Подтвердите каждую вставку. Интервалы должны идти по порядку без пересечений и укладываться в основную часть и выбранные исходники. Два перехода вместе должны помещаться внутри вставки. Общий размер выбранных файлов — до 256 MiB.</p>:null}
    <p className="muted">Плавные переходы смешивают вставку с основной частью в начале и конце её интервала. Они не сдвигают монтаж; у соседних вставок переход проходит через основную часть.</p>
    <p className="muted">До пяти MP4-вставок заменяют изображение на выбранных интервалах. Их звук выключен; голос, музыка, субтитры и длительность сохраняются. Время отсчитывается от начала основной части, после intro.</p>
  </fieldset>;
}
