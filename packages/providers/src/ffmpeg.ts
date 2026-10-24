import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,rm,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {z} from 'zod';
import {coverComposition} from './cover-design';
import {musicMixSchema,musicFadesFit,DomainError,videoBookendTimingSchema,brollTimingsSchema,maxBrollTotalBytes,maxMediaSourceBytes,videoProcessingSchema,videoDimensions,type VideoProcessingProvider,type VideoProcessingOptions,type OperationContext,type CoverRenderingProvider} from '@contentos/types';
const maxBytes=256*1024*1024,maxDuration=180;
const probeSchema=z.object({format:z.object({duration:z.coerce.number().finite().positive().max(maxDuration)}),streams:z.array(z.object({codec_type:z.string(),codec_name:z.string().optional(),duration:z.coerce.number().finite().positive().optional(),avg_frame_rate:z.string().optional(),width:z.number().int().positive().max(8192).optional(),height:z.number().int().positive().max(8192).optional(),pix_fmt:z.string().optional()})).max(8)});
const timestamp=(seconds:number)=>{const centiseconds=Math.round(seconds*100);return `${Math.floor(centiseconds/360000)}:${String(Math.floor(centiseconds/6000)%60).padStart(2,'0')}:${String(Math.floor(centiseconds/100)%60).padStart(2,'0')}.${String(centiseconds%100).padStart(2,'0')}`;};
export function captionAss(options:VideoProcessingOptions,width:number,height:number){
  const fontSize=Math.round(height*(options.captionStyle==='bold'?0.045:0.035));
  // eslint-disable-next-line no-control-regex -- Strip control bytes from untrusted subtitle text.
  const text=(value:string)=>value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').replace(/\\/g,'＼').replace(/\{/g,'｛').replace(/\}/g,'｝').replace(/\r?\n/g,'\\N');
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,${options.captionStyle==='bold'?-1:0},0,0,0,100,100,0,0,1,2,1,2,${Math.round(width*.07)},${Math.round(width*.07)},${Math.round(height*.08)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${options.captions.map(segment=>`Dialogue: 0,${timestamp(segment.start)},${timestamp(segment.end)},Default,,0,0,0,,${text(segment.text)}`).join('\n')}\n`;
}
/** Literal text lives in a private ASS file, never in the FFmpeg filter expression. */
export function watermarkAss(watermark:NonNullable<VideoProcessingOptions['watermark']>,width:number,height:number){
  const text=watermark.text.replace(/\\/g,'＼').replace(/\{/g,'｛').replace(/\}/g,'｝');
  const fontSize=Math.max(12,Math.floor(Math.min(Math.min(width,height)*.035,width*.7/Array.from(text).length)));
  const alpha=Math.round(255*(1-watermark.opacity/100)).toString(16).padStart(2,'0').toUpperCase();
  const alignment={TOP_LEFT:7,TOP_RIGHT:9,BOTTOM_LEFT:1,BOTTOM_RIGHT:3}[watermark.position],margin=Math.round(Math.min(width,height)*.05);
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Mark,Arial,${fontSize},&H${alpha}FFFFFF,&H${alpha}FFFFFF,&H${alpha}000000,&HFF000000,0,0,0,0,100,100,0,0,1,1,0,${alignment},${margin},${margin},${margin},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:03:01.00,Mark,,0,0,0,,${text}\n`;
}
/** Worker-only local media processing. No URLs, shell fragments or user paths. */
export class FFmpegVideoProcessor implements VideoProcessingProvider,CoverRenderingProvider {
  constructor(private readonly ffmpeg:string,private readonly ffprobe:string){if(!isAbsolute(ffmpeg)||!isAbsolute(ffprobe))throw new DomainError('CONFIGURATION_REQUIRED',503);}
  async prepareAudio(bytes:Uint8Array,context:OperationContext){
    if(bytes.byteLength<12||bytes.byteLength>maxBytes||Buffer.from(bytes.subarray(4,8)).toString('ascii')!=='ftyp')throw new DomainError('INVALID_MEDIA',422);
    const directory=await mkdtemp(join(tmpdir(),'contentos-audio-'));
    try{
      await writeFile(join(directory,'source.mp4'),bytes,{mode:0o600});
      const source=await this.inspect('source.mp4',directory,context);
      await this.run(this.ffmpeg,['-nostdin','-v','error','-y','-threads','1','-protocol_whitelist','file,pipe','-enable_drefs','0','-use_absolute_path','0','-f','mov','-i','source.mp4','-map','0:a:0','-vn','-map_metadata','-1','-ac','1','-ar','16000','-c:a','pcm_s16le','-t',String(maxDuration),'-fs','6000000','-f','wav','audio.wav'],directory,context,60_000);
      const audio=await readFile(join(directory,'audio.wav'));
      if(audio.length<44||audio.length>=6_000_000||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw new DomainError('INVALID_MEDIA',422);
      return {bytes:audio,durationSeconds:source.duration};
    }finally{await rm(directory,{recursive:true,force:true});}
  }
  private run(binary:string,args:string[],cwd:string,context:OperationContext,timeout=180_000):Promise<string>{
    return new Promise((resolve,reject)=>{
      execFile(binary,args,{cwd,encoding:'utf8',maxBuffer:512*1024,timeout,killSignal:'SIGKILL',signal:context.signal,env:{NODE_ENV:'production',PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',HOME:cwd,TMPDIR:cwd}},(error,stdout)=>{
        if(error){const code='code' in error?error.code:undefined;reject(new DomainError(code==='ENOENT'||code==='EACCES'?'CONFIGURATION_REQUIRED':'INVALID_MEDIA',code==='ENOENT'||code==='EACCES'?503:422));}
        else resolve(stdout);
      });
    });
  }
  private async inspect(file:string,cwd:string,context:OperationContext,broll=false){
    const output=await this.run(this.ffprobe,['-v','error','-threads','1','-max_alloc','268435456','-protocol_whitelist','file,pipe','-enable_drefs','0','-use_absolute_path','0','-f','mov','-show_entries','format=duration:stream=codec_type,codec_name,width,height,pix_fmt,duration,avg_frame_rate','-of','json',file],cwd,context,30_000);
    let decoded:unknown;try{decoded=JSON.parse(output);}catch{throw new DomainError('INVALID_MEDIA',422);}
    const parsed=(broll?probeSchema.extend({format:z.object({duration:z.coerce.number().finite().positive().max(180.5)})}):probeSchema).safeParse(decoded);if(!parsed.success)throw new DomainError('INVALID_MEDIA',422);
    const video=parsed.data.streams.filter(stream=>stream.codec_type==='video'),audio=parsed.data.streams.filter(stream=>stream.codec_type==='audio');
    if(video.length!==1||(broll?audio.length>1||parsed.data.streams.length!==video.length+audio.length:audio.length!==1)||!video[0]!.width||!video[0]!.height||video[0]!.width*video[0]!.height>16_000_000||video[0]!.width>8192||video[0]!.height>8192)throw new DomainError('INVALID_MEDIA',422);
    const [numerator,denominator]=(video[0]!.avg_frame_rate??'30/1').split('/').map(Number);
    const rate=numerator&&denominator?numerator/denominator:30;
    if(broll&&(video[0]!.codec_name!=='h264'||video[0]!.pix_fmt!=='yuv420p'||video[0]!.width!>1920||video[0]!.height!>1920||Math.abs(rate-30)>.01||!Number.isFinite(rate)))throw new DomainError('INVALID_MEDIA',422);
    // Container duration may include an AAC tail after the last video frame.
    const videoDuration=video[0]!.duration??parsed.data.format.duration;
    const lastFrameSeconds=Math.max(0,videoDuration-1/(rate>0&&rate<=240?rate:30)-.001);
    return {lastFrameSeconds,duration:parsed.data.format.duration,video:video[0]!,audio:audio[0]!};
  }
  private async prepareMusic(bytes:Uint8Array,directory:string,context:OperationContext){
    if(bytes.byteLength<12||bytes.byteLength>maxMediaSourceBytes)throw new DomainError('INVALID_MEDIA',422);
    const head=Buffer.from(bytes.subarray(0,3));
    if(head.toString('ascii')!=='ID3'&&!(head[0]===255&&(head[1]!&0xe0)===0xe0))throw new DomainError('INVALID_MEDIA',422);
    await writeFile(join(directory,'music.mp3'),bytes,{mode:0o600});
    const raw=await this.run(this.ffprobe,['-v','error','-threads','1','-max_alloc','268435456','-protocol_whitelist','file,pipe','-f','mp3','-show_entries','format=duration:stream=codec_type,codec_name,channels,sample_rate','-of','json','music.mp3'],directory,context,30_000);
    let decoded:unknown;try{decoded=JSON.parse(raw);}catch{throw new DomainError('INVALID_MEDIA',422);}
    const parsed=z.object({format:z.object({duration:z.coerce.number().finite().positive().max(180.5)}),streams:z.array(z.object({codec_type:z.literal('audio'),codec_name:z.literal('mp3'),channels:z.literal(2),sample_rate:z.coerce.number().pipe(z.literal(48000))})).length(1)}).safeParse(decoded);
    if(!parsed.success)throw new DomainError('INVALID_MEDIA',422);
  }
  private async prepareBookends(input:Parameters<VideoProcessingProvider['process']>[0]['bookends'],directory:string,context:OperationContext){
    const clips:{slot:'intro'|'outro';sourceStartMs:number;durationMs:number;hasAudio:boolean}[]=[];
    for(const slot of ['intro','outro'] as const){
      const clip=input?.[slot];if(!clip)continue;
      const timing=videoBookendTimingSchema.parse({sourceStartMs:clip.sourceStartMs,durationMs:clip.durationMs});
      if(clip.bytes.byteLength<12||clip.bytes.byteLength>maxMediaSourceBytes||Buffer.from(clip.bytes.subarray(4,8)).toString('ascii')!=='ftyp')throw new DomainError('INVALID_MEDIA',422);
      await writeFile(join(directory,`${slot}.mp4`),clip.bytes,{mode:0o600});
      const media=await this.inspect(`${slot}.mp4`,directory,context,true);
      if(timing.sourceStartMs+timing.durationMs>(media.video.duration??media.duration)*1000+1)throw new DomainError('INVALID_INPUT');
      clips.push({slot,...timing,hasAudio:!!media.audio});
    }
    return clips;
  }
  private async concatenateBookends(clips:Awaited<ReturnType<FFmpegVideoProcessor['prepareBookends']>>,directory:string,scale:string,mainDuration:number,context:OperationContext){
    await rename(join(directory,'final.mp4'),join(directory,'main.mp4'));
    const ordered=[...clips.filter(clip=>clip.slot==='intro'),{slot:'main' as const,sourceStartMs:0,durationMs:mainDuration*1000,hasAudio:true},...clips.filter(clip=>clip.slot==='outro')];
    const inputs:string[]=[],filters:string[]=[];
    for(const [index,clip] of ordered.entries()){
      inputs.push('-threads','1','-protocol_whitelist','file,pipe','-enable_drefs','0','-use_absolute_path','0','-f','mov','-i',`${clip.slot}.mp4`);
      const start=clip.sourceStartMs/1000,duration=clip.durationMs/1000;
      filters.push(`[${index}:v:0]trim=start=${start}:duration=${duration},setpts=PTS-STARTPTS,${scale},setsar=1,fps=30,format=yuv420p[v${index}]`);
      filters.push(clip.hasAudio?`[${index}:a:0]atrim=start=${start}:duration=${duration},asetpts=PTS-STARTPTS,${clip.slot==='main'?'':'loudnorm=I=-16:TP=-1.5:LRA=11,'}aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${duration}[a${index}]`:`anullsrc=r=48000:cl=stereo,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`);
    }
    filters.push(`${ordered.map((_,index)=>`[v${index}][a${index}]`).join('')}concat=n=${ordered.length}:v=1:a=1[video][audio]`);
    await this.run(this.ffmpeg,['-nostdin','-hide_banner','-v','error','-y','-max_alloc','268435456',...inputs,'-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map','[video]','-map','[audio]','-map_metadata','-1','-map_chapters','-1','-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-ar','48000','-ac','2','-b:a','128k','-t',String(mainDuration+clips.reduce((sum,clip)=>sum+clip.durationMs/1000,0)),'-fs',String(maxBytes),'-movflags','+faststart','-f','mp4','final.mp4'],directory,context);
  }
  private async renderCoverFile(directory:string,width:number,height:number,duration:number,lastFrameSeconds:number,design:VideoProcessingOptions['cover'],context:OperationContext){
    let filter='scale=480:-2';
    if(design){const composition=coverComposition(design,width,height);await writeFile(join(directory,'cover.ass'),composition.ass,{mode:0o600});filter=composition.filter;}
    const frameSeconds=design?Math.max(0,Math.min(design.frameSeconds??duration*.01*design.framePercent,lastFrameSeconds)):0;
    await this.run(this.ffmpeg,['-nostdin','-hide_banner','-v','error','-y','-threads','1','-filter_threads','1','-max_alloc','268435456','-protocol_whitelist','file,pipe','-enable_drefs','0','-use_absolute_path','0','-ss',String(frameSeconds),'-f','mov','-i','final.mp4','-map','0:v:0','-an','-map_metadata','-1','-frames:v','1','-vf',filter,'-q:v','3','-update','1','cover.jpg'],directory,context,30_000);
  }
  async renderCover(input:Parameters<CoverRenderingProvider['renderCover']>[0],context:OperationContext){
    context.signal.throwIfAborted();
    if(input.bytes.byteLength<12||input.bytes.byteLength>maxBytes||Buffer.from(input.bytes.subarray(4,8)).toString('ascii')!=='ftyp')throw new DomainError('INVALID_MEDIA',422);
    const directory=await mkdtemp(join(tmpdir(),'contentos-cover-'));
    try{
      await writeFile(join(directory,'final.mp4'),input.bytes,{mode:0o600});const source=await this.inspect('final.mp4',directory,context);
      const width=source.video.width!,height=source.video.height!;
      if(width>1920||height>1920)throw new DomainError('INVALID_MEDIA',422);
      await this.renderCoverFile(directory,width,height,source.duration,source.lastFrameSeconds,input.design,context);
      const size=await stat(join(directory,'cover.jpg'));if(!size.size||size.size>3*1024*1024)throw new DomainError('INVALID_MEDIA',422);
      const bytes=await readFile(join(directory,'cover.jpg'));if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw new DomainError('INVALID_MEDIA',422);
      return {bytes,width,height};
    }finally{await rm(directory,{recursive:true,force:true});}
  }
  async process(input:Parameters<VideoProcessingProvider['process']>[0],context:OperationContext){
    const options=videoProcessingSchema.parse(input.options);context.signal.throwIfAborted();
    if(input.bytes.byteLength<12||input.bytes.byteLength>maxBytes||Buffer.from(input.bytes.subarray(4,8)).toString('ascii')!=='ftyp')throw new DomainError('INVALID_MEDIA',422);
    const directory=await mkdtemp(join(tmpdir(),'contentos-video-'));const started=Date.now();let outcome='FAILED';
    try{
      await writeFile(join(directory,'source.mp4'),input.bytes,{mode:0o600});
      const source=await this.inspect('source.mp4',directory,context);
      const bookends=await this.prepareBookends(input.bookends,directory,context);
      const expectedDuration=source.duration+bookends.reduce((sum,clip)=>sum+clip.durationMs/1000,0);
      const maximum=input.maximumDurationSeconds??maxDuration;
      if(!Number.isInteger(maximum)||maximum<1||maximum>maxDuration||expectedDuration>maximum)throw new DomainError('INVALID_INPUT');
      if(input.broll&&input.brollClips)throw new DomainError('INVALID_INPUT');
      const brollClips=input.brollClips??(input.broll?[input.broll]:[]);
      const checked=input.broll||input.brollClips?brollTimingsSchema.safeParse(brollClips.map(clip=>({...(clip.fadeMs!==undefined?{fadeMs:clip.fadeMs}:{}),startMs:clip.startMs,endMs:clip.endMs,sourceStartMs:clip.sourceStartMs}))):null;
      if(checked&&!checked.success)throw new DomainError('INVALID_INPUT');
      const timings=checked?.success?checked.data:[];
      if(brollClips.reduce((sum,clip)=>sum+clip.bytes.byteLength,0)>maxBrollTotalBytes)throw new DomainError('INVALID_MEDIA',422);
      for(const [index,timing] of timings.entries()){
        const bytes=brollClips[index]!.bytes;
        if(bytes.byteLength<12||bytes.byteLength>maxMediaSourceBytes||Buffer.from(bytes.subarray(4,8)).toString('ascii')!=='ftyp')throw new DomainError('INVALID_MEDIA',422);
        await writeFile(join(directory,`broll-${index}.mp4`),bytes,{mode:0o600});
        const clip=await this.inspect(`broll-${index}.mp4`,directory,context,true);
        if(timing.endMs>(source.video.duration??source.duration)*1000+1||timing.sourceStartMs+timing.endMs-timing.startMs>(clip.video.duration??clip.duration)*1000+1)throw new DomainError('INVALID_INPUT');
      }
      if(options.captions.some(segment=>segment.end>source.duration+.05))throw new DomainError('INVALID_INPUT');
      const {width,height}=videoDimensions(options.orientation,options.resolution);
      const scale=options.fit==='crop'?`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`:`scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
      await input.onStage?.('CAPTIONS_GENERATING',{mode:options.captions.length?'provided-segments':'disabled'});
      if(options.captions.length)await writeFile(join(directory,'captions.ass'),captionAss(options,width,height),{mode:0o600});
      if(options.watermark)await writeFile(join(directory,'watermark.ass'),watermarkAss(options.watermark,width,height),{mode:0o600});
      await input.onStage?.('BROLL_PROCESSING',{mode:timings.length?'user-media':'disabled',clipCount:timings.length,intervals:timings.map(({startMs,endMs})=>({startMs,endMs}))});
      if(input.backgroundMusic){
        const {bytes:_bytes,...mix}=input.backgroundMusic;
        if(!musicMixSchema.safeParse(mix).success||!musicFadesFit(mix,source.duration*1000))throw new DomainError('INVALID_INPUT');
        await this.prepareMusic(input.backgroundMusic.bytes,directory,context);
      }
      const filters:string[]=[];
      if(input.backgroundMusic)filters.push(`[0:a:0]asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[voice];[1:a:0]atrim=duration=${source.duration},asetpts=PTS-STARTPTS,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,volume=${input.backgroundMusic.volumePercent/100}${input.backgroundMusic.fadeInMs?`,afade=t=in:st=0:d=${input.backgroundMusic.fadeInMs/1000}`:''}${input.backgroundMusic.fadeOutMs?`,afade=t=out:st=${source.duration-input.backgroundMusic.fadeOutMs/1000}:d=${input.backgroundMusic.fadeOutMs/1000}`:''}[music];[voice][music]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95:level=0,aresample=48000[mixed]`);
      const audioArgs=input.backgroundMusic?['-map','[mixed]']:['-map','0:a:0','-af','loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000'];
      const musicInput=input.backgroundMusic?['-threads','1','-stream_loop','-1','-protocol_whitelist','file,pipe','-f','mp3','-i','music.mp3']:[];
      const brollInput=timings.flatMap((_,index)=>['-threads','1','-protocol_whitelist','file,pipe','-enable_drefs','0','-use_absolute_path','0','-f','mov','-i',`broll-${index}.mp4`]);
      const decoration=`${options.captions.length?',ass=filename=captions.ass':''}${options.watermark?',ass=filename=watermark.ass':''}`;
      if(timings.length){
        filters.push(`[0:v:0]setpts=PTS-STARTPTS,${scale},setsar=1,fps=30[base0]`);
        for(const [index,timing] of timings.entries()){
          const inputIndex=(input.backgroundMusic?2:1)+index;
          const duration=(timing.endMs-timing.startMs)/1000;
          const composition=timing.fadeMs?`setpts=PTS-STARTPTS,${scale},setsar=1,fps=30,format=yuva420p,fade=t=in:st=0:d=${timing.fadeMs/1000}:alpha=1,fade=t=out:st=${(timing.endMs-timing.startMs-timing.fadeMs)/1000}:d=${timing.fadeMs/1000}:alpha=1,setpts=PTS+${timing.startMs/1000}/TB`:`setpts=PTS-STARTPTS+${timing.startMs/1000}/TB,${scale},setsar=1,fps=30`;
          filters.push(`[${inputIndex}:v:0]trim=start=${timing.sourceStartMs/1000}:duration=${duration},${composition}[cut${index}];[base${index}][cut${index}]overlay=x=0:y=0:eof_action=pass:repeatlast=0:enable='gte(t,${timing.startMs/1000})*lt(t,${timing.endMs/1000})'[base${index+1}]`);
        }
        filters.push(`[base${timings.length}]${decoration?decoration.slice(1):'null'}[composed]`);
      }
      const videoArgs=timings.length?['-map','[composed]']:['-map','0:v:0','-vf',`${scale},setsar=1,fps=30${decoration}`];
      const graphArgs=filters.length?['-filter_complex_threads','1','-filter_complex',filters.join(';')]:[];
      await this.run(this.ffmpeg,['-nostdin','-hide_banner','-v','error','-y','-threads','1','-filter_threads','1','-max_alloc','268435456','-protocol_whitelist','file,pipe','-enable_drefs','0','-use_absolute_path','0','-f','mov','-i','source.mp4',...musicInput,...brollInput,...graphArgs,...videoArgs,...audioArgs,'-map_metadata','-1','-map_chapters','-1','-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','128k','-ac','2','-t',String(maxDuration),'-fs',String(maxBytes),'-movflags','+faststart','-f','mp4','final.mp4'],directory,context);
      if(bookends.length)await this.concatenateBookends(bookends,directory,scale,source.duration,context);
      const final=await this.inspect('final.mp4',directory,context);
      await input.onStage?.('COVER_GENERATING',{mode:options.cover?'designed-frame':'first-frame'});
      await this.renderCoverFile(directory,width,height,final.duration,final.lastFrameSeconds,options.cover,context);
      await input.onStage?.('QC',{});
      if(final.video.width!==width||final.video.height!==height||final.video.codec_name!=='h264'||final.audio.codec_name!=='aac'||final.video.pix_fmt!=='yuv420p'||Math.abs(final.duration-expectedDuration)>.3||Math.ceil(final.duration)>maximum)throw new DomainError('INVALID_MEDIA',422);
      const [videoStat,coverStat]=await Promise.all([stat(join(directory,'final.mp4')),stat(join(directory,'cover.jpg'))]);
      if(!videoStat.size||videoStat.size>=maxBytes||!coverStat.size||coverStat.size>3*1024*1024)throw new DomainError('INVALID_MEDIA',422);
      const [bytes,thumbnail]=await Promise.all([readFile(join(directory,'final.mp4')),readFile(join(directory,'cover.jpg'))]);outcome='SUCCEEDED';
      return {bytes,thumbnail,durationSeconds:final.duration,width,height};
    }finally{
      await rm(directory,{recursive:true,force:true});
      console.log(JSON.stringify({event:'video_processing',provider:'ffmpeg',jobId:context.internalId,correlationId:context.correlationId,durationMs:Date.now()-started,status:outcome}));
    }
  }
}
