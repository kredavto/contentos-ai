import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {FFmpegVideoProcessor,captionAss} from '../packages/providers/src/ffmpeg';
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
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','color=c=green:s=320x240:r=30:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-map','0:v','-map','1:a','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-shortest','-movflags','+faststart',join(directory,'fixture.mp4')]);
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
  it('fails closed for missing binaries and honors cancellation',async()=>{
    await expect(new FFmpegVideoProcessor('/nonexistent/ffmpeg','/nonexistent/ffprobe').process({bytes,options:videoProcessingSchema.parse({})},context())).rejects.toThrow('CONFIGURATION_REQUIRED');
    const abort=new AbortController();abort.abort();await expect(processor.process({bytes,options:videoProcessingSchema.parse({})},{...context(),signal:abort.signal})).rejects.toThrow();
  });
});
