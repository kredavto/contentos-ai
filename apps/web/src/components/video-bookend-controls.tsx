'use client';
import {videoBookendSchema} from '@contentos/types';
export type BookendDraft={assetId:string;start:string;duration:string;approved:boolean};
export const emptyBookend:BookendDraft={assetId:'',start:'0',duration:'1',approved:false};
type Asset={id:string;name:string;durationMs:number|null};
export function selectedBookend(value:BookendDraft,assets:Asset[]){
  const asset=assets.find(item=>item.id===value.assetId);
  const parsed=videoBookendSchema.safeParse({assetId:value.assetId,sourceStartMs:Number(value.start)*1000,durationMs:Number(value.duration)*1000,approved:value.approved});
  return parsed.success&&value.start&&value.duration&&asset&&parsed.data.sourceStartMs+parsed.data.durationMs<=(asset.durationMs??0)?parsed.data:undefined;
}
export function VideoBookendControls({label,value,assets,disabled,onChange}:{label:string;value:BookendDraft;assets:Asset[];disabled:boolean;onChange:(value:BookendDraft)=>void}){
  return <fieldset className="stack" disabled={disabled}><legend>{label}</legend>
    <label>{label} из медиатеки<select aria-label={`${label} из медиатеки`} value={value.assetId} onChange={event=>onChange({...value,assetId:event.target.value,approved:false})}>
      <option value="">Без заставки</option>
      {value.assetId&&!assets.some(asset=>asset.id===value.assetId)?<option value={value.assetId}>Выбранный файл недоступен</option>:null}
      {assets.map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}
    </select></label>
    {value.assetId?<>
      <label>{label}: начало фрагмента, сек.<input type="number" min="0" max="179.9" step="0.1" required value={value.start} onChange={event=>onChange({...value,start:event.target.value,approved:false})}/></label>
      <label>{label}: длительность, сек.<input type="number" min="0.1" max="30" step="0.1" required value={value.duration} onChange={event=>onChange({...value,duration:event.target.value,approved:false})}/></label>
      <label><input type="checkbox" checked={value.approved} onChange={event=>onChange({...value,approved:event.target.checked})}/>Подтверждаю {label} и выбранный фрагмент</label>
      {!selectedBookend(value,assets)?<p className="notice warning">Выберите доступный фрагмент от 0,1 до 30 секунд и подтвердите заставку.</p>:null}
    </>:null}
  </fieldset>;
}
