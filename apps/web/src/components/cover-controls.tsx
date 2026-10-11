'use client';
import type {CoverDesign} from '@contentos/types';
export const initialCoverDesign:CoverDesign={framePercent:0,headline:'',background:'FRAME',font:'BOLD',layout:'BOTTOM',textColor:'#ffffff',backgroundColor:'#182338'};
export function CoverControls({value,onChange}:{value:CoverDesign;onChange:(value:CoverDesign)=>void}){
  function update<K extends keyof CoverDesign>(key:K,next:CoverDesign[K]){onChange({...value,[key]:next});}
  return <fieldset className="stack"><legend>Обложка видео</legend>
    <label>Заголовок обложки<input aria-label="Заголовок обложки" required maxLength={80} value={value.headline} onChange={event=>update('headline',event.target.value)}/></label>
    <div className="studio-form">
      <label>Кадр обложки<select aria-label="Кадр обложки" value={value.framePercent} onChange={event=>update('framePercent',Number(event.target.value))}><option value={0}>Начало</option><option value={25}>Четверть ролика</option><option value={50}>Середина</option><option value={75}>Три четверти</option><option value={95}>Ближе к концу</option></select></label>
      <label>Фон обложки<select aria-label="Фон обложки" value={value.background} onChange={event=>update('background',event.target.value as CoverDesign['background'])}><option value="FRAME">Кадр с цветной подложкой</option><option value="SOLID">Сплошной цвет</option></select></label>
      <label>Шрифт обложки<select aria-label="Шрифт обложки" value={value.font} onChange={event=>update('font',event.target.value as CoverDesign['font'])}><option value="SANS">Без засечек</option><option value="BOLD">Жирный</option><option value="SERIF">С засечками</option></select></label>
      <label>Расположение заголовка<select aria-label="Расположение заголовка" value={value.layout} onChange={event=>update('layout',event.target.value as CoverDesign['layout'])}><option value="TOP">Сверху</option><option value="CENTER">По центру</option><option value="BOTTOM">Снизу</option></select></label>
      <label>Цвет текста<input aria-label="Цвет текста обложки" type="color" value={value.textColor} onChange={event=>update('textColor',event.target.value)}/></label>
      <label>Цвет фона<input aria-label="Цвет фона обложки" type="color" value={value.backgroundColor} onChange={event=>update('backgroundColor',event.target.value)}/></label>
    </div>
    <p className="muted">Используйте цвета вашего бренда. Кадр выбирается по положению в готовом ролике; при сплошном фоне он скрыт. Заголовок переносится автоматически. Готовая обложка появится после обработки видео; изменение после рендера пока недоступно.</p>
  </fieldset>;
}
