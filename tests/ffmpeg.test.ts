import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {FFmpegVideoProcessor,captionAss,watermarkAss} from '../packages/providers/src/ffmpeg';
import sharp from 'sharp';
import {coverDesignSchema} from '../packages/types/src/covers';
import {videoProcessingSchema,videoWatermarkSchema} from '../packages/types/src/video-processing';
const ffmpeg=process.env.FFMPEG_PATH??(process.env.CI?'/usr/bin/ffmpeg':undefined),ffprobe=process.env.FFPROBE_PATH??(process.env.CI?'/usr/bin/ffprobe':undefined);
const context=()=>({tenantId:randomUUID(),internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:new AbortController().signal});
it('validates caption timing and prevents ASS override injection',()=>{
  expect(()=>videoProcessingSchema.parse({captions:[{start:1,end:2,text:'A'},{start:1.5,end:3,text:'B'}]})).toThrow();
  const ass=captionAss(videoProcessingSchema.parse({captions:[{start:0,end:1,text:'{\\pos(0,0)} Привет\nМир'}]}),720,1280);
  expect(ass).not.toContain('{\\pos');expect(ass).toContain('Привет\\NМир');
});
it('keeps watermark opt-in and rejects unsafe or unsupported settings',()=>{
  expect(videoProcessingSchema.parse({}).watermark).toBeUndefined();
  const valid={text:'Бренд',position:'TOP_RIGHT',opacity:60};
  for(const text of ['', 'x'.repeat(41),'line\nnext','hidden\u202e','separator\u2028next'])expect(videoWatermarkSchema.safeParse({...valid,text}).success).toBe(false);
  for(const opacity of [0,19,101,NaN,20.5])expect(videoWatermarkSchema.safeParse({...valid,opacity}).success).toBe(false);
  expect(videoWatermarkSchema.safeParse({...valid,logoUrl:'https://example.com/image'}).success).toBe(false);
  const ass=watermarkAss(videoWatermarkSchema.parse({...valid,text:'{\\pos(0,0)} Бренд'}),720,1280);
  expect(ass).not.toContain('{\\pos');expect(ass).toContain('Бренд');expect(ass.match(/Dialogue:/g)).toHaveLength(1);
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
  it('clamps cover selection to the video stream when audio extends beyond its last frame',async()=>{
    const file=join(directory,'audio-tail.mp4');
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','color=c=red:s=320x240:r=30:d=1','-f','lavfi','-i','sine=frequency=440:duration=2','-map','0:v','-map','1:a','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',file]);
    const cover=coverDesignSchema.parse({framePercent:95,headline:'Tail',background:'FRAME',font:'SANS',layout:'BOTTOM',textColor:'#ffffff',backgroundColor:'#182338'});
    const rendered=await processor.renderCover({bytes:await readFile(file),design:cover},context());
    expect((await sharp(rendered.bytes).metadata()).width).toBe(320);
    const pixel=await sharp(rendered.bytes).extract({left:0,top:0,width:1,height:1}).raw().toBuffer();expect(pixel[0]).toBeGreaterThan(220);
  });
  it.each(['TOP_LEFT','TOP_RIGHT','BOTTOM_LEFT','BOTTOM_RIGHT'] as const)('burns a literal %s watermark into actual video frames only',async position=>{
    const original=Buffer.from(bytes),watermark={text:'БРЕНД',position,opacity:100};
    const output=await processor.process({bytes,options:videoProcessingSchema.parse({orientation:'1:1',resolution:'720p',watermark})},context());
    const file=join(directory,`watermark-${position}.mp4`),frame=join(directory,`watermark-${position}.png`);
    await (await import('node:fs/promises')).writeFile(file,output.bytes);
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-ss','0.7','-i',file,'-frames:v','1','-update','1',frame]);
    const raster=await sharp(frame).raw().toBuffer({resolveWithObject:true});let bright=0,elsewhere=0;
    for(let y=0;y<720;y++)for(let x=0;x<720;x++){const offset=(y*720+x)*raster.info.channels;if(raster.data[offset]!>200&&raster.data[offset+1]!>200&&raster.data[offset+2]!>200){const inside=(position.endsWith('LEFT')?x<360:x>=360)&&(position.startsWith('TOP')?y<180:y>=540);if(inside)bright++;else elsewhere++;}}
    expect(bright).toBeGreaterThan(100);expect(elsewhere).toBe(0);expect(bytes).toEqual(original);
  });
  it('extracts bounded mono PCM WAV for transcription',async()=>{const audio=await processor.prepareAudio(bytes,context());expect(Buffer.from(audio.bytes.subarray(0,4)).toString()).toBe('RIFF');expect(Buffer.from(audio.bytes.subarray(8,12)).toString()).toBe('WAVE');expect(audio.bytes.length).toBeLessThan(6000000);expect(audio.durationSeconds).toBeGreaterThan(.8);});
  it('fails closed for missing binaries and honors cancellation',async()=>{
    await expect(new FFmpegVideoProcessor('/nonexistent/ffmpeg','/nonexistent/ffprobe').process({bytes,options:videoProcessingSchema.parse({})},context())).rejects.toThrow('CONFIGURATION_REQUIRED');
    const abort=new AbortController();abort.abort();await expect(processor.process({bytes,options:videoProcessingSchema.parse({})},{...context(),signal:abort.signal})).rejects.toThrow();
  });
});
