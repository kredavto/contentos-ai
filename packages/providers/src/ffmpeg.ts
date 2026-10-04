import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {z} from 'zod';
import {DomainError,videoProcessingSchema,videoDimensions,type VideoProcessingProvider,type VideoProcessingOptions,type OperationContext} from '@contentos/types';
const maxBytes=256*1024*1024,maxDuration=180;
const probeSchema=z.object({format:z.object({duration:z.coerce.number().finite().positive().max(maxDuration)}),streams:z.array(z.object({codec_type:z.string(),codec_name:z.string().optional(),width:z.number().int().positive().max(8192).optional(),height:z.number().int().positive().max(8192).optional(),pix_fmt:z.string().optional()})).max(8)});
const timestamp=(seconds:number)=>{const centiseconds=Math.round(seconds*100);return `${Math.floor(centiseconds/360000)}:${String(Math.floor(centiseconds/6000)%60).padStart(2,'0')}:${String(Math.floor(centiseconds/100)%60).padStart(2,'0')}.${String(centiseconds%100).padStart(2,'0')}`;};
export function captionAss(options:VideoProcessingOptions,width:number,height:number){
  const fontSize=Math.round(height*(options.captionStyle==='bold'?0.045:0.035));
  // eslint-disable-next-line no-control-regex -- Strip control bytes from untrusted subtitle text.
  const text=(value:string)=>value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g,'').replace(/\\/g,'＼').replace(/\{/g,'｛').replace(/\}/g,'｝').replace(/\r?\n/g,'\\N');
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,${options.captionStyle==='bold'?-1:0},0,0,0,100,100,0,0,1,2,1,2,${Math.round(width*.07)},${Math.round(width*.07)},${Math.round(height*.08)},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${options.captions.map(segment=>`Dialogue: 0,${timestamp(segment.start)},${timestamp(segment.end)},Default,,0,0,0,,${text(segment.text)}`).join('\n')}\n`;
}
/** Worker-only local media processing. No URLs, shell fragments or user paths. */
export class FFmpegVideoProcessor implements VideoProcessingProvider {
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
  private async inspect(file:string,cwd:string,context:OperationContext){
    const output=await this.run(this.ffprobe,['-v','error','-threads','1','-max_alloc','268435456','-protocol_whitelist','file,pipe','-enable_drefs','0','-use_absolute_path','0','-f','mov','-show_entries','format=duration:stream=codec_type,codec_name,width,height,pix_fmt','-of','json',file],cwd,context,30_000);
    let decoded:unknown;try{decoded=JSON.parse(output);}catch{throw new DomainError('INVALID_MEDIA',422);}
    const parsed=probeSchema.safeParse(decoded);if(!parsed.success)throw new DomainError('INVALID_MEDIA',422);
    const video=parsed.data.streams.filter(stream=>stream.codec_type==='video'),audio=parsed.data.streams.filter(stream=>stream.codec_type==='audio');
    if(video.length!==1||audio.length!==1||!video[0]!.width||!video[0]!.height||video[0]!.width*video[0]!.height>16_000_000||video[0]!.width>8192||video[0]!.height>8192)throw new DomainError('INVALID_MEDIA',422);
    return {duration:parsed.data.format.duration,video:video[0]!,audio:audio[0]!};
  }
  async process(input:Parameters<VideoProcessingProvider['process']>[0],context:OperationContext){
    const options=videoProcessingSchema.parse(input.options);context.signal.throwIfAborted();
    if(input.bytes.byteLength<12||input.bytes.byteLength>maxBytes||Buffer.from(input.bytes.subarray(4,8)).toString('ascii')!=='ftyp')throw new DomainError('INVALID_MEDIA',422);
    const directory=await mkdtemp(join(tmpdir(),'contentos-video-'));const started=Date.now();let outcome='FAILED';
    try{
      await writeFile(join(directory,'source.mp4'),input.bytes,{mode:0o600});
      const source=await this.inspect('source.mp4',directory,context);
      if(options.captions.some(segment=>segment.end>source.duration+.05))throw new DomainError('INVALID_INPUT');
      const {width,height}=videoDimensions(options.orientation,options.resolution);
      const scale=options.fit==='crop'?`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`:`scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
      await input.onStage?.('CAPTIONS_GENERATING',{mode:options.captions.length?'provided-segments':'disabled'});
      if(options.captions.length)await writeFile(join(directory,'captions.ass'),captionAss(options,width,height),{mode:0o600});
      await input.onStage?.('BROLL_PROCESSING',{mode:'disabled'});
      const videoFilter=`${scale},setsar=1,fps=30${options.captions.length?',ass=filename=captions.ass':''}`;
      await this.run(this.ffmpeg,['-nostdin','-hide_banner','-v','error','-y','-threads','1','-filter_threads','1','-max_alloc','268435456','-protocol_whitelist','file,pipe','-enable_drefs','0','-use_absolute_path','0','-f','mov','-i','source.mp4','-map','0:v:0','-map','0:a:0','-map_metadata','-1','-map_chapters','-1','-vf',videoFilter,'-af','loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000','-c:v','libx264','-preset','fast','-crf','22','-pix_fmt','yuv420p','-threads','2','-c:a','aac','-b:a','128k','-ac','2','-t',String(maxDuration),'-fs',String(maxBytes),'-movflags','+faststart','-f','mp4','final.mp4'],directory,context);
      await input.onStage?.('COVER_GENERATING',{mode:'first-frame'});
      await this.run(this.ffmpeg,['-nostdin','-hide_banner','-v','error','-y','-threads','1','-protocol_whitelist','file,pipe','-f','mov','-i','final.mp4','-frames:v','1','-vf','scale=480:-2','-q:v','3','-update','1','cover.jpg'],directory,context,30_000);
      await input.onStage?.('QC',{});
      const final=await this.inspect('final.mp4',directory,context);
      if(final.video.width!==width||final.video.height!==height||final.video.codec_name!=='h264'||final.audio.codec_name!=='aac'||final.video.pix_fmt!=='yuv420p'||Math.abs(final.duration-source.duration)>.3)throw new DomainError('INVALID_MEDIA',422);
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
