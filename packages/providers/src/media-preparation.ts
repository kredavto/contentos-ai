import {execFile} from 'node:child_process';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {z} from 'zod';
import {DomainError,maxMediaSourceBytes,mediaSourceMimeSchema,type MediaPreparationProvider,type MediaSourceMime,type OperationContext} from '@contentos/types';

const probeSchema=z.object({format:z.object({duration:z.coerce.number().finite().positive().max(180.5)}),streams:z.array(z.object({codec_type:z.enum(['video','audio']),codec_name:z.string(),width:z.number().int().positive().max(4096).optional(),height:z.number().int().positive().max(4096).optional(),channels:z.number().int().min(1).max(8).optional(),sample_rate:z.coerce.number().int().min(8000).max(192000).optional(),avg_frame_rate:z.string().optional()})).min(1).max(2)});
const demuxer:Record<MediaSourceMime,string>={'video/mp4':'mov','audio/mpeg':'mp3','audio/wav':'wav'};
function validHeader(bytes:Uint8Array,mime:MediaSourceMime){
  if(bytes.byteLength<12||bytes.byteLength>maxMediaSourceBytes)return false;
  const head=Buffer.from(bytes.subarray(0,12));
  return mime==='video/mp4'?head.toString('ascii',4,8)==='ftyp':mime==='audio/wav'?head.toString('ascii',0,4)==='RIFF'&&head.toString('ascii',8,12)==='WAVE':head.toString('ascii',0,3)==='ID3'||head[0]===255&&(head[1]!&0xe0)===0xe0;
}
/** Untrusted uploads are decoded/transcoded locally before becoming reusable media. */
export class FFmpegMediaPreparation implements MediaPreparationProvider {
  constructor(private readonly ffmpeg:string,private readonly ffprobe:string){if(!isAbsolute(ffmpeg)||!isAbsolute(ffprobe))throw new DomainError('CONFIGURATION_REQUIRED',503);}
  private run(binary:string,args:string[],cwd:string,context:OperationContext,timeout:number):Promise<string>{
    context.signal.throwIfAborted();
    return new Promise((resolve,reject)=>execFile(binary,args,{cwd,encoding:'utf8',maxBuffer:512*1024,timeout,killSignal:'SIGKILL',signal:context.signal,env:{NODE_ENV:'production',PATH:'/usr/bin:/bin',LANG:'en_US.UTF-8',HOME:cwd,TMPDIR:cwd}},(error,stdout)=>{
      if(error){const unavailable=error.code==='ENOENT'||error.code==='EACCES';reject(new DomainError(unavailable?'CONFIGURATION_REQUIRED':'INVALID_MEDIA',unavailable?503:422));}else resolve(stdout);
    }));
  }
  private inputFlags(mime:MediaSourceMime){return ['-protocol_whitelist','file,pipe',...(mime==='video/mp4'?['-enable_drefs','0','-use_absolute_path','0']:[]),'-f',demuxer[mime]];}
  private async inspect(file:string,mime:MediaSourceMime,cwd:string,context:OperationContext){
    const raw=await this.run(this.ffprobe,['-v','error','-threads','1','-max_alloc','268435456',...this.inputFlags(mime),'-show_entries','format=duration:stream=codec_type,codec_name,width,height,channels,sample_rate,avg_frame_rate','-of','json',file],cwd,context,30_000);
    let data:unknown;try{data=JSON.parse(raw);}catch{throw new DomainError('INVALID_MEDIA',422);}
    const parsed=probeSchema.safeParse(data);if(!parsed.success)throw new DomainError('INVALID_MEDIA',422);
    const video=parsed.data.streams.filter(stream=>stream.codec_type==='video'),audio=parsed.data.streams.filter(stream=>stream.codec_type==='audio');
    if(mime==='video/mp4'?video.length!==1||audio.length>1:video.length!==0||audio.length!==1)throw new DomainError('INVALID_MEDIA',422);
    if(video[0]){const v=video[0],parts=v.avg_frame_rate?.split('/').map(Number),fps=parts?.length===2?parts[0]!/parts[1]!:0;if(!v.width||!v.height||v.width*v.height>8_388_608||!Number.isFinite(fps)||fps<=0||fps>120)throw new DomainError('INVALID_MEDIA',422);}
    if(audio.some(stream=>!stream.channels||!stream.sample_rate))throw new DomainError('INVALID_MEDIA',422);
    return {duration:parsed.data.format.duration,video:video[0],audio:audio[0]};
  }
  async prepare(input:Parameters<MediaPreparationProvider['prepare']>[0],context:OperationContext){
    context.signal.throwIfAborted();
    const parsedMime=mediaSourceMimeSchema.safeParse(input.mimeType);
    if(!parsedMime.success)throw new DomainError('INVALID_MEDIA',422);
    const mime=parsedMime.data;
    if(!validHeader(input.bytes,mime))throw new DomainError('INVALID_MEDIA',422);
    const directory=await mkdtemp(join(tmpdir(),'contentos-media-'));
    try{
      await writeFile(join(directory,'source'),input.bytes,{mode:0o600});
      const source=await this.inspect('source',mime,directory,context);if(source.duration>180)throw new DomainError('INVALID_MEDIA',422);
      const video=mime==='video/mp4',outputMime=video?'video/mp4' as const:'audio/mpeg' as const,file=video?'normalized.mp4':'normalized.mp3';
      const videoArgs=video?['-map','0:v:0','-map','0:a:0?','-vf',"scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=30",'-c:v','libx264','-preset','fast','-crf','23','-maxrate','2500k','-bufsize','5000k','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart']:['-map','0:a:0','-vn','-c:a','libmp3lame','-b:a','192k','-id3v2_version','0','-write_id3v1','0'];
      await this.run(this.ffmpeg,['-nostdin','-hide_banner','-v','error','-y','-xerror','-threads','1','-filter_threads','1','-max_alloc','268435456','-err_detect','explode',...this.inputFlags(mime),'-i','source',...videoArgs,...(source.audio?['-ac','2','-ar','48000']:[]),'-threads','2','-map_metadata','-1','-map_chapters','-1','-t','180','-fs',String(maxMediaSourceBytes),'-f',video?'mp4':'mp3',file],directory,context,180_000);
      const size=await stat(join(directory,file));if(size.size<12||size.size>=maxMediaSourceBytes)throw new DomainError('INVALID_MEDIA',422);
      const normalized=await this.inspect(file,outputMime,directory,context);
      if(Math.abs(normalized.duration-source.duration)>.35||Boolean(normalized.audio)!==Boolean(source.audio)||video&&(normalized.video?.codec_name!=='h264'||normalized.video.width!>1920||normalized.video.height!>1920)||normalized.audio&&normalized.audio.codec_name!==(video?'aac':'mp3'))throw new DomainError('INVALID_MEDIA',422);
      return {bytes:await readFile(join(directory,file)),mimeType:outputMime,durationMs:Math.ceil(normalized.duration*1000),width:normalized.video?.width??null,height:normalized.video?.height??null,hasAudio:!!normalized.audio};
    }finally{await rm(directory,{recursive:true,force:true});}
  }
}
