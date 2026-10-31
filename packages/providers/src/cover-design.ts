import {coverDesignSchema,type CoverDesign} from '@contentos/types';
/** Literal text only: no user-supplied ASS tags, filenames, fonts or filter expressions. */
export function coverComposition(raw:CoverDesign,width:number,height:number){
  const design=coverDesignSchema.parse(raw);
  const literal=design.headline.replace(/\\/g,'＼').replace(/\{/g,'｛').replace(/\}/g,'｝');
  const lines:string[]=[];let line='';
  for(const word of literal.split(/\s+/u)){
    if(line&&Array.from(`${line} ${word}`).length>20){lines.push(line);line='';}
    const characters=Array.from(word);
    while(characters.length>20){if(line){lines.push(line);line='';}lines.push(characters.splice(0,20).join(''));}
    const tail=characters.join('');if(tail)line=line?`${line} ${tail}`:tail;
  }
  if(line)lines.push(line);
  const panelHeight=Math.round(height*.44),top=design.layout==='TOP'?0:design.layout==='BOTTOM'?height-panelHeight:Math.round((height-panelHeight)/2);
  const fontSize=Math.max(1,Math.floor(Math.min(width/25,panelHeight/(Math.max(1,lines.length)*1.5))));
  const font=design.font==='SERIF'?'DejaVu Serif':'DejaVu Sans';
  const rgb=design.textColor.slice(1),assColor=`&H00${rgb.slice(4,6)}${rgb.slice(2,4)}${rgb.slice(0,2)}`;
  const ass=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${font},${fontSize},${assColor},${assColor},&H00000000,&H00000000,${design.font==='BOLD'?-1:0},0,0,0,100,100,0,0,1,0,0,5,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:10:00.00,Default,,0,0,0,,{\\pos(${Math.round(width/2)},${Math.round(top+panelHeight/2)})}${lines.join('\\N')}\n`;
  const background=design.background==='SOLID'?`drawbox=x=0:y=0:w=iw:h=ih:color=${design.backgroundColor}:t=fill`:`drawbox=x=0:y=${top}:w=iw:h=${panelHeight}:color=${design.backgroundColor}@0.88:t=fill`;
  return {ass,filter:`setpts=PTS-STARTPTS,${background},ass=filename=cover.ass`};
}
