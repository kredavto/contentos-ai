import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {FFmpegVideoProcessor,captionAss} from '../packages/providers/src/ffmpeg';
import sharp from 'sharp';
import {coverDesignSchema} from '../packages/types/src/covers';
import {videoProcessingSchema} from '../packages/types/src/video-processing';
const ffmpeg=process.env.FFMPEG_PATH??(process.env.CI?'/usr/bin/ffmpeg':undefined),ffprobe=process.env.FFPROBE_PATH??(process.env.CI?'/usr/bin/ffprobe':undefined);
const context=()=>({tenantId:randomUUID(),internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal});
it('validates caption timing and prevents ASS override injection',()=>{
  expect(()=>videoProcessingSchema.parse({captions:[{start:1,end:2,text:'A'},{start:1.5,end:3,text:'B'}]})).toThrow();
  const ass=captionAss(videoProcessingSchema.parse({captions:[{start:0,end:1,text:'{\\pos(0,0)} Привет\nМир'}]}),720,1280);
  expect(ass).not.toContain('{\\pos');expect(ass).toContain('Привет\\NМир');
});
describe.skipIf(!ffmpeg||!ffprobe)('real FFmpeg media processing',()=>{
  const processor=new FFmpegVideoProcessor(ffmpeg??'/missing/ffmpeg',ffprobe??'/missing/ffprobe');let directory='',bytes:Buffer;
  beforeAll(async()=>{
    directory=await mkdtemp(join(tmpdir(),'contentos-fixture-'));
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','color=c=green:s=320x240:r=30:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-map','0:v','-map','1:a','-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=red:t=fill:enable='gte(t,0.5)'",'-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-shortest','-movflags','+faststart',join(directory,'fixture.mp4')]);
    bytes=await readFile(join(directory,'fixture.mp4'));
  });
  afterAll(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});
  it.each([['9:16',720,1280],['1:1',720,720],['16:9',1280,720]] as const)('normalizes %s and produces a separate JPEG cover',async(orientation,width,height)=>{
    const output=await processor.process({bytes,options:videoProcessingSchema.parse({orientation,resolution:'720p',fit:'contain'})},context());
    expect(output.width).toBe(width);expect(output.height).toBe(height);expect(output.durationSeconds).toBeGreaterThan(.8);expect(output.durationSeconds).toBeLessThan(1.3);
    expect(Buffer.from(output.bytes.subarray(4,8)).toString()).toBe('ftyp');expect([...output.thumbnail.subarray(0,3)]).toEqual([255,216,255]);expect(output.bytes).not.toEqual(bytes);
  });
  it('burns Unicode captions and rejects invalid media and out-of-range captions',async()=>{
    const output=await processor.process({bytes,options:videoProcessingSchema.parse({resolution:'720p',captions:[{start:0,end:.8,text:'Проверка субтитров'}],captionStyle:'bold'})},context());
    const plain=await processor.process({bytes,options:videoProcessingSchema.parse({resolution:'720p'})},context());
    expect(output.thumbnail).not.toEqual(plain.thumbnail);
    await expect(processor.process({bytes:new TextEncoder().encode('#EXTM3U\nhttp://127.0.0.1/private'),options:videoProcessingSchema.parse({})},context())).rejects.toThrow('INVALID_MEDIA');
    await expect(processor.process({bytes,options:videoProcessingSchema.parse({captions:[{start:0,end:10,text:'Too long'}]})},context())).rejects.toThrow('INVALID_INPUT');
  });
  it.each(['TOP','CENTER','BOTTOM'] as const)('renders a full-resolution %s cover with literal Unicode text and brand colors',async layout=>{
    const cover=coverDesignSchema.parse({framePercent:50,headline:'Проверенный заголовок',background:'SOLID',font:layout==='TOP'?'SANS':layout==='CENTER'?'SERIF':'BOLD',layout,textColor:'#ffffff',backgroundColor:'#182338'});
    const designed=await processor.process({bytes,options:videoProcessingSchema.parse({resolution:'720p',cover})},context());
    const metadata=await sharp(designed.thumbnail).metadata();expect(metadata.width).toBe(720);expect(metadata.height).toBe(1280);expect(metadata.format).toBe('jpeg');
    const pixel=await sharp(designed.thumbnail).extract({left:0,top:0,width:1,height:1}).raw().toBuffer();
    expect(Math.abs(pixel[0]!-24)).toBeLessThan(6);expect(Math.abs(pixel[1]!-35)).toBeLessThan(6);expect(Math.abs(pixel[2]!-56)).toBeLessThan(6);
    const stats=await sharp(designed.thumbnail).stats();expect(stats.channels[0]!.max).toBeGreaterThan(220);
  });
  it('uses the selected final-video frame while preserving the encoded video',async()=>{
    const cover=coverDesignSchema.parse({framePercent:0,headline:'Тест',background:'FRAME',font:'BOLD',layout:'BOTTOM',textColor:'#ffffff',backgroundColor:'#182338'});
    const first=await processor.process({bytes,options:videoProcessingSchema.parse({resolution:'720p',cover})},context());
    const late=await processor.process({bytes,options:videoProcessingSchema.parse({resolution:'720p',cover:{...cover,framePercent:95}})},context());
    expect(first.bytes).toEqual(late.bytes);expect(first.thumbnail.length).toBeLessThan(3*1024*1024);
    const pixel=await sharp(late.thumbnail).extract({left:300,top:50,width:1,height:1}).raw().toBuffer();expect(pixel[0]).toBeGreaterThan(220);expect(pixel[1]).toBeLessThan(20);expect(first.thumbnail).not.toEqual(late.thumbnail);
    const regenerated=await processor.renderCover({bytes:first.bytes,design:{...cover,headline:'Новый заголовок',framePercent:0,frameSeconds:.75}},context());expect(regenerated.width).toBe(720);expect(regenerated.height).toBe(1280);expect((await sharp(regenerated.bytes).metadata()).format).toBe('jpeg');expect(regenerated.bytes).not.toEqual(late.thumbnail);const chosenPixel=await sharp(regenerated.bytes).extract({left:300,top:50,width:1,height:1}).raw().toBuffer();expect(chosenPixel[0]).toBeGreaterThan(220);
  });
  it('extracts bounded mono PCM WAV for transcription',async()=>{const audio=await processor.prepareAudio(bytes,context());expect(Buffer.from(audio.bytes.subarray(0,4)).toString()).toBe('RIFF');expect(Buffer.from(audio.bytes.subarray(8,12)).toString()).toBe('WAVE');expect(audio.bytes.length).toBeLessThan(6000000);expect(audio.durationSeconds).toBeGreaterThan(.8);});
  it('fails closed for missing binaries and honors cancellation',async()=>{
    await expect(new FFmpegVideoProcessor('/nonexistent/ffmpeg','/nonexistent/ffprobe').process({bytes,options:videoProcessingSchema.parse({})},context())).rejects.toThrow('CONFIGURATION_REQUIRED');
    const abort=new AbortController();abort.abort();await expect(processor.process({bytes,options:videoProcessingSchema.parse({})},{...context(),signal:abort.signal})).rejects.toThrow();
  });
});
