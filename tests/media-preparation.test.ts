import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {FFmpegMediaPreparation} from '../packages/providers/src/media-preparation';
import {mediaSourceSchema} from '../packages/types/src/media-preparation';
const ffmpeg=process.env.FFMPEG_PATH??(process.env.CI?'/usr/bin/ffmpeg':undefined),ffprobe=process.env.FFPROBE_PATH??(process.env.CI?'/usr/bin/ffprobe':undefined),exec=promisify(execFile);
const context=()=>({tenantId:randomUUID(),internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal});
it('validates bounded source declarations without accepting URLs or extra fields',()=>{
  const input={mimeType:'video/mp4',bytes:64*1024*1024,sha256:'a'.repeat(64)};expect(mediaSourceSchema.parse(input)).toEqual(input);
  for(const extra of [{bytes:0},{bytes:input.bytes+1},{mimeType:'text/html'},{sha256:'invalid'},{url:'https://example.com/movie'}])expect(mediaSourceSchema.safeParse({...input,...extra}).success).toBe(false);
});
it('rejects relative executable paths and invalid runtime MIME values before starting a process',async()=>{
  expect(()=>new FFmpegMediaPreparation('ffmpeg','/usr/bin/ffprobe')).toThrow('CONFIGURATION_REQUIRED');
  expect(()=>new FFmpegMediaPreparation('/usr/bin/ffmpeg','ffprobe')).toThrow('CONFIGURATION_REQUIRED');
  const processor=new FFmpegMediaPreparation('/missing/ffmpeg','/missing/ffprobe');
  await expect(processor.prepare({bytes:new Uint8Array(12),mimeType:'text/html' as 'video/mp4'},context())).rejects.toThrow('INVALID_MEDIA');
});
describe.skipIf(!ffmpeg||!ffprobe)('real audio/video preparation',()=>{
  let directory='',wav:Buffer,mp3:Buffer,video:Buffer,silent:Buffer;
  const processor=new FFmpegMediaPreparation(ffmpeg??'/missing/ffmpeg',ffprobe??'/missing/ffprobe');
  // Four real media fixtures can exceed the default hook budget on shared Docker hosts.
  beforeAll(async()=>{
    directory=await mkdtemp(join(tmpdir(),'contentos-preparation-test-'));
    const audio=['-f','lavfi','-i','sine=frequency=440:duration=0.6'];
    for(const [name,codec] of [['source.wav','pcm_s16le'],['source.mp3','libmp3lame']])await exec(ffmpeg!,['-nostdin','-v','error',...audio,'-c:a',codec!,'-metadata','title=PRIVATE SOURCE TITLE',join(directory,name!)]);
    for(const sound of [false,true])await exec(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=2560x1440:r=24:d=0.6',...(sound?audio:[]),'-map','0:v:0',...(sound?['-map','1:a:0']:[]),'-c:v','libx264','-threads','1','-pix_fmt','yuv420p',...(sound?['-c:a','aac','-shortest']:[]),'-metadata','title=PRIVATE SOURCE TITLE','-movflags','+faststart',join(directory,sound?'source.mp4':'silent.mp4')]);
    [wav,mp3,video,silent]=await Promise.all(['source.wav','source.mp3','source.mp4','silent.mp4'].map(name=>readFile(join(directory,name)))) as [Buffer,Buffer,Buffer,Buffer];
  },120_000);
  afterAll(async()=>{await rm(directory,{recursive:true,force:true});});
  it.each(['audio/wav','audio/mpeg'] as const)('decodes %s, strips private metadata and returns real stereo MP3',async mimeType=>{
    const input=mimeType==='audio/wav'?wav:mp3,original=Buffer.from(input),result=await processor.prepare({bytes:input,mimeType},context());
    expect(result).toMatchObject({mimeType:'audio/mpeg',width:null,height:null,hasAudio:true});expect(result.durationMs).toBeGreaterThan(500);expect(result.durationMs).toBeLessThan(1000);expect(input).toEqual(original);
    const file=join(directory,`${mimeType.replace('/','-')}-out.mp3`);await writeFile(file,result.bytes);
    const probe=JSON.parse((await exec(ffprobe!,['-v','error','-show_streams','-show_format','-of','json',file])).stdout);
    expect(probe.streams[0]).toMatchObject({codec_name:'mp3',channels:2,sample_rate:'48000'});expect(JSON.stringify(probe)).not.toContain('PRIVATE SOURCE TITLE');
  });
  it.each([true,false])('normalizes oversized MP4 dimensions and preserves audio presence: %s',async sound=>{
    const result=await processor.prepare({bytes:sound?video:silent,mimeType:'video/mp4'},context());
    expect(result).toMatchObject({mimeType:'video/mp4',width:1920,height:1080,hasAudio:sound});expect(result.durationMs).toBeGreaterThan(500);expect(result.durationMs).toBeLessThan(1000);
    const file=join(directory,`video-${sound}-out.mp4`);await writeFile(file,result.bytes);
    const probe=JSON.parse((await exec(ffprobe!,['-v','error','-show_streams','-show_format','-of','json',file])).stdout);
    expect(probe.streams[0]).toMatchObject({codec_name:'h264',pix_fmt:'yuv420p',width:1920,height:1080});expect(probe.streams.filter((s:{codec_type:string})=>s.codec_type==='audio')).toHaveLength(sound?1:0);expect(JSON.stringify(probe)).not.toContain('PRIVATE SOURCE TITLE');
  });
  it('rejects fake headers, mismatched types, truncated containers and playlists',async()=>{
    for(const bytes of [Buffer.from('#EXTM3U\nhttp://127.0.0.1/private'),Buffer.from('0000ftyp0000000000000000'),video.subarray(0,32)])await expect(processor.prepare({bytes,mimeType:'video/mp4'},context())).rejects.toThrow('INVALID_MEDIA');
    await expect(processor.prepare({bytes:wav,mimeType:'audio/mpeg'},context())).rejects.toThrow('INVALID_MEDIA');
  });
  it('rejects excess duration before transcoding and multiple audio streams',async()=>{
    const long=join(directory,'long.wav'),multi=join(directory,'multi.mp4');
    await exec(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','anullsrc=r=8000:cl=mono','-t','181','-c:a','pcm_s16le',long]);
    await expect(processor.prepare({bytes:await readFile(long),mimeType:'audio/wav'},context())).rejects.toThrow('INVALID_MEDIA');
    await exec(ffmpeg!,['-nostdin','-v','error','-i',join(directory,'source.mp4'),'-map','0:v','-map','0:a','-map','0:a','-c','copy',multi]);
    await expect(processor.prepare({bytes:await readFile(multi),mimeType:'video/mp4'},context())).rejects.toThrow('INVALID_MEDIA');
  });
  it('honors cancellation and reports unavailable executables without exposing process errors',async()=>{
    await expect(processor.prepare({bytes:video,mimeType:'video/mp4'},{...context(),signal:AbortSignal.abort()})).rejects.toThrow();
    await expect(new FFmpegMediaPreparation('/missing/ffmpeg','/missing/ffprobe').prepare({bytes:video,mimeType:'video/mp4'},context())).rejects.toThrow('CONFIGURATION_REQUIRED');
  });
});
