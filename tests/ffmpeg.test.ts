import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
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
  it('mixes a short looping music track at the selected level while preserving voice and duration',async()=>{
    const musicFile=join(directory,'music.mp3');
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=880:duration=0.25','-ac','2','-ar','48000','-c:a','libmp3lame',musicFile]);
    const music=await readFile(musicFile),ratios:number[]=[];
    for(const volumePercent of [5,25]){
      const rendered=await processor.process({bytes,backgroundMusic:{bytes:music,volumePercent},options:videoProcessingSchema.parse({resolution:'720p',orientation:'1:1'})},context());
      expect(Math.abs(rendered.durationSeconds-1)).toBeLessThan(.15);
      const file=join(directory,`music-${volumePercent}.mp4`);await writeFile(file,rendered.bytes);
      const result=await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});
      const amplitude=(frequency:number,start:number)=>{let real=0,imaginary=0;const count=4800;for(let i=0;i<count;i++){const sample=result.stdout.readFloatLE((start+i)*4),phase=2*Math.PI*frequency*(start+i)/48000;real+=sample*Math.cos(phase);imaginary+=sample*Math.sin(phase);}return 2*Math.hypot(real,imaginary)/count;};
      const voice=amplitude(440,33600),bed=amplitude(880,33600);
      expect(voice).toBeGreaterThan(.04);expect(bed).toBeGreaterThan(.002); // Music is still audible after multiple loops.
      expect(amplitude(880,9600)).toBeGreaterThan(.002);
      ratios.push(bed/voice);
    }
    expect(ratios[1]!/ratios[0]!).toBeGreaterThan(3);expect(ratios[1]!/ratios[0]!).toBeLessThan(7);
  });
  it.each([{fadeInMs:300},{fadeOutMs:400},{fadeInMs:300,fadeOutMs:400}])('fades only music at main-relative edges, including with bookends: %j',async fades=>{
    const tag=`${fades.fadeInMs??0}-${fades.fadeOutMs??0}`,musicFile=join(directory,`music-fades-${tag}.mp3`);
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=880:duration=0.25','-ac','2','-ar','48000','-c:a','libmp3lame',musicFile]);
    const bookend={bytes,sourceStartMs:0,durationMs:300};
    const rendered=await processor.process({bytes,bookends:{intro:bookend,outro:bookend},backgroundMusic:{bytes:await readFile(musicFile),volumePercent:25,...fades},options:videoProcessingSchema.parse({resolution:'720p',orientation:'1:1'})},context());
    expect(Math.abs(rendered.durationSeconds-1.6)).toBeLessThan(.15);
    const file=join(directory,`music-fades-${tag}.mp4`);await writeFile(file,rendered.bytes);
    const pcm=await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});
    const tone=(frequency:number,time:number)=>{let real=0,imaginary=0;const start=Math.round(time*48000),count=4800;for(let i=0;i<count;i++){const sample=pcm.stdout.readFloatLE((start+i)*4),phase=2*Math.PI*frequency*(start+i)/48000;real+=sample*Math.cos(phase);imaginary+=sample*Math.sin(phase);}return 2*Math.hypot(real,imaginary)/count;};
    const baseline=await processor.process({bytes,bookends:{intro:bookend,outro:bookend},backgroundMusic:{bytes:await readFile(musicFile),volumePercent:25},options:videoProcessingSchema.parse({resolution:'720p',orientation:'1:1'})},context());
    const baselineFile=join(directory,`music-baseline-${tag}.mp4`);await writeFile(baselineFile,baseline.bytes);
    const reference=await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-i',baselineFile,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});
    const referenceTone=(frequency:number,time:number)=>{let real=0,imaginary=0;const start=Math.round(time*48000),count=4800;for(let i=0;i<count;i++){const sample=reference.stdout.readFloatLE((start+i)*4),phase=2*Math.PI*frequency*(start+i)/48000;real+=sample*Math.cos(phase);imaginary+=sample*Math.sin(phase);}return 2*Math.hypot(real,imaginary)/count;};
    expect(tone(880,.75)).toBeGreaterThan(.005);
    // Compare matching windows: MP3 loop padding can change the baseline amplitude over time.
    for(const [time,faded] of [[.34,!!fades.fadeInMs],[1.18,!!fades.fadeOutMs],[.75,false]] as const){
      const ratio=tone(880,time)/referenceTone(880,time);
      if(faded){expect(ratio).toBeGreaterThan(.05);expect(ratio).toBeLessThan(.6);}else{expect(ratio).toBeGreaterThan(.8);expect(ratio).toBeLessThan(1.2);}
      expect(tone(440,time)/referenceTone(440,time)).toBeGreaterThan(.8);expect(tone(440,time)/referenceTone(440,time)).toBeLessThan(1.2);expect(tone(440,time)).toBeGreaterThan(.04);
    }
    expect(tone(880,.1)).toBeLessThan(.001);expect(tone(880,1.4)).toBeLessThan(.001);
  });
  it('rejects music fades outside bounds or longer than the actual main video',async()=>{
    for(const fades of [{fadeInMs:0},{fadeOutMs:99},{fadeInMs:5001},{fadeOutMs:100.5},{fadeInMs:600,fadeOutMs:500},{fadeOutMs:1100}])await expect(processor.process({bytes,backgroundMusic:{bytes:Buffer.alloc(12),volumePercent:15,...fades},options:videoProcessingSchema.parse({})},context())).rejects.toThrow('INVALID_INPUT');
  });
  it('rejects invalid music bytes, video masquerading as music and unsafe volume settings',async()=>{
    for(const music of [Buffer.from('#EXTM3U\nhttps://example.test/private'),bytes])await expect(processor.process({bytes,backgroundMusic:{bytes:music,volumePercent:15},options:videoProcessingSchema.parse({resolution:'720p'})},context())).rejects.toThrow('INVALID_MEDIA');
    for(const volumePercent of [0,31,1.5,NaN])await expect(processor.process({bytes,backgroundMusic:{bytes:Buffer.alloc(12),volumePercent},options:videoProcessingSchema.parse({})},context())).rejects.toThrow('INVALID_INPUT');
  });
  it.each([false,true])('composes a timed B-roll excerpt with captions, watermark and preserved audio (music=%s)',async withMusic=>{
    const clipFile=join(directory,`broll-${withMusic}.mp4`),musicFile=join(directory,'broll-music.mp3');
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','color=c=yellow:s=320x240:r=30:d=1',...(withMusic?['-f','lavfi','-i','sine=frequency=1760:duration=1']:[]),'-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='gte(t,0.4)'",'-c:v','libx264','-threads','1','-pix_fmt','yuv420p',...(withMusic?['-c:a','aac']:['-an']),'-movflags','+faststart',clipFile]);
    if(withMusic)await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=880:duration=0.25','-ac','2','-ar','48000','-c:a','libmp3lame',musicFile]);
    const output=await processor.process({bytes,broll:{bytes:await readFile(clipFile),startMs:200,endMs:700,sourceStartMs:500},...(withMusic?{backgroundMusic:{bytes:await readFile(musicFile),volumePercent:20}}:{}),options:videoProcessingSchema.parse({resolution:'720p',orientation:'1:1',captions:[{start:0,end:.9,text:'SUBTITLE'}],watermark:{text:'BRAND',position:'TOP_RIGHT',opacity:100}})},context());
    expect(Math.abs(output.durationSeconds-1)).toBeLessThan(.15);
    const file=join(directory,`composed-${withMusic}.mp4`);await writeFile(file,output.bytes);
    for(const [time,channel] of [[.1,1],[.3,2],[.65,2],[.85,0]] as const){
      const frame=join(directory,`broll-frame-${withMusic}-${time}.png`);
      await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-ss',String(time),'-i',file,'-frames:v','1','-update','1',frame]);
      const pixel=await sharp(frame).extract({left:10,top:300,width:1,height:1}).raw().toBuffer();
      expect(pixel[channel]).toBeGreaterThan(channel===1?90:220);expect(pixel[(channel+1)%3]).toBeLessThan(30);
      if(time===.3){
        for(const region of [{left:0,top:540,width:720,height:180},{left:360,top:0,width:360,height:180}]){
          const raster=await sharp(frame).extract(region).removeAlpha().raw().toBuffer();let white=0;
          for(let i=0;i<raster.length;i+=3)if(raster[i]!>220&&raster[i+1]!>220&&raster[i+2]!>220)white++;
          expect(white).toBeGreaterThan(100);
        }
      }
    }
    const decoded=await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});
    const tone=(frequency:number)=>{let real=0,imaginary=0;for(let i=14400;i<19200;i++){const sample=decoded.stdout.readFloatLE(i*4),phase=2*Math.PI*frequency*i/48000;real+=sample*Math.cos(phase);imaginary+=sample*Math.sin(phase);}return 2*Math.hypot(real,imaginary)/4800;};
    expect(tone(440)).toBeGreaterThan(.04);expect(tone(1760)).toBeLessThan(tone(440)*.02);
    if(withMusic)expect(tone(880)).toBeGreaterThan(.002);
  });
  it('rejects B-roll outside the real video timeline or source excerpt and rejects non-video bytes',async()=>{
    const options=videoProcessingSchema.parse({resolution:'720p'});
    for(const timing of [{startMs:0,endMs:1200,sourceStartMs:0},{startMs:0,endMs:500,sourceStartMs:800}])await expect(processor.process({bytes,broll:{bytes,...timing},options},context())).rejects.toThrow('INVALID_INPUT');
    await expect(processor.process({bytes,broll:{bytes:Buffer.from('#EXTM3U\nhttps://example.test/private'),startMs:0,endMs:500,sourceStartMs:0},options},context())).rejects.toThrow('INVALID_MEDIA');
  });
  it('concatenates trimmed intro/outro, keeps main-relative overlays and music, and pads a silent outro',async()=>{
    const introFile=join(directory,'intro.mp4'),outroFile=join(directory,'outro.mp4'),musicFile=join(directory,'bookend-music.mp3');
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','color=c=yellow:s=320x240:r=30:d=1','-f','lavfi','-i','sine=frequency=1760:duration=1','-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='gte(t,0.4)'",'-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',introFile]);
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','color=c=yellow:s=240x320:r=30:d=1','-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',outroFile]);
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=880:duration=0.25','-ac','2','-ar','48000','-c:a','libmp3lame',musicFile]);
    const intro=await readFile(introFile),outro=await readFile(outroFile),original=Buffer.from(bytes);
    const output=await processor.process({bytes,maximumDurationSeconds:3,bookends:{intro:{bytes:intro,sourceStartMs:400,durationMs:600},outro:{bytes:outro,sourceStartMs:100,durationMs:800}},broll:{bytes:intro,sourceStartMs:400,startMs:200,endMs:600},backgroundMusic:{bytes:await readFile(musicFile),volumePercent:20},options:videoProcessingSchema.parse({orientation:'1:1',resolution:'720p',captions:[{start:0,end:.9,text:'SUBTITLE'}],watermark:{text:'BRAND',position:'TOP_RIGHT',opacity:100}})},context());
    expect(Math.abs(output.durationSeconds-2.4)).toBeLessThan(.1);expect(bytes).toEqual(original);
    const file=join(directory,'bookends.mp4');await writeFile(file,output.bytes);
    for(const [time,channel,decorated] of [[.2,2,false],[.7,1,true],[.95,2,true],[1.4,0,true],[1.9,0,false]] as const){
      const frame=join(directory,`bookend-${time}.png`);await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-ss',String(time),'-i',file,'-frames:v','1','-update','1',frame]);
      const pixel=await sharp(frame).extract({left:10,top:300,width:1,height:1}).raw().toBuffer();expect(pixel[channel]).toBeGreaterThan(channel===1?90:220);
      const raster=await sharp(frame).extract({left:360,top:0,width:360,height:180}).removeAlpha().raw().toBuffer();let white=0;
      for(let i=0;i<raster.length;i+=3)if(raster[i]!>220&&raster[i+1]!>220&&raster[i+2]!>220)white++;
      if(decorated)expect(white).toBeGreaterThan(100);else expect(white).toBe(0);
      if(time===.95){const stats=await sharp(frame).extract({left:0,top:540,width:720,height:180}).stats();expect(stats.channels[0]!.max).toBeGreaterThan(220);}
    }
    const decoded=await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});
    const tone=(frequency:number,time:number)=>{let real=0,imaginary=0;const start=Math.round(time*48000);for(let i=start;i<start+4800;i++){const sample=decoded.stdout.readFloatLE(i*4),phase=2*Math.PI*frequency*i/48000;real+=sample*Math.cos(phase);imaginary+=sample*Math.sin(phase);}return 2*Math.hypot(real,imaginary)/4800;};
    expect(tone(1760,.2)).toBeGreaterThan(.04);expect(tone(440,.2)).toBeLessThan(.001);expect(tone(880,.2)).toBeLessThan(.001);
    expect(tone(440,.95)).toBeGreaterThan(.04);expect(tone(880,.95)).toBeGreaterThan(.002);expect(tone(1760,.95)).toBeLessThan(.001);
    for(const frequency of [440,880,1760])expect(tone(frequency,1.9)).toBeLessThan(.001);
    const coverPixel=await sharp(output.thumbnail).extract({left:10,top:10,width:1,height:1}).raw().toBuffer();expect(coverPixel[2]).toBeGreaterThan(220);
  });
  it.each(['intro','outro'] as const)('supports a standalone %s and rejects unavailable excerpts or insufficient duration budget',async slot=>{
    const options=videoProcessingSchema.parse({orientation:'1:1',resolution:'720p'}),clip={bytes,sourceStartMs:200,durationMs:400};
    const output=await processor.process({bytes,bookends:{[slot]:clip},options},context());expect(Math.abs(output.durationSeconds-1.4)).toBeLessThan(.1);
    await expect(processor.process({bytes,bookends:{[slot]:{...clip,sourceStartMs:900}},options},context())).rejects.toThrow('INVALID_INPUT');
    await expect(processor.process({bytes,maximumDurationSeconds:1,bookends:{[slot]:clip},options},context())).rejects.toThrow('INVALID_INPUT');
    await expect(processor.process({bytes,bookends:{[slot]:{...clip,bytes:Buffer.from('#EXTM3U\nhttps://example.test/private')}},options},context())).rejects.toThrow('INVALID_MEDIA');
  });
  it('renders five adjacent inserts with source offsets, music, captions and bookends without changing the main duration',async()=>{
    const clipFile=join(directory,'multi-broll.mp4'),musicFile=join(directory,'multi-broll.mp3');
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=320x240:r=30:d=1','-f','lavfi','-i','sine=frequency=1760:duration=1','-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=yellow:t=fill:enable='gte(t,0.4)'",'-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',clipFile]);
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=880:duration=0.25','-ac','2','-ar','48000','-c:a','libmp3lame',musicFile]);
    const clipBytes=await readFile(clipFile),bookend={bytes:clipBytes,sourceStartMs:0,durationMs:300};
    const clips=Array.from({length:5},(_,index)=>({bytes:clipBytes,startMs:100+index*100,endMs:200+index*100,sourceStartMs:index%2?500:0}));
    const options=videoProcessingSchema.parse({orientation:'1:1',resolution:'720p',captions:[{start:0,end:.9,text:'SUBTITLE'}],watermark:{text:'BRAND',position:'TOP_RIGHT',opacity:100}});
    const output=await processor.process({bytes,brollClips:clips,bookends:{intro:bookend,outro:bookend},backgroundMusic:{bytes:await readFile(musicFile),volumePercent:20},options},context());
    expect(Math.abs(output.durationSeconds-1.6)).toBeLessThan(.1);
    const file=join(directory,'multi-composed.mp4');await writeFile(file,output.bytes);
    for(const [time,color] of [[.05,'green'],[.15,'blue'],[.25,'yellow'],[.35,'blue'],[.45,'yellow'],[.55,'blue'],[.75,'red']] as const){
      const frame=join(directory,`multi-${time}.png`);await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-ss',String(time+.3),'-i',file,'-frames:v','1','-update','1',frame]);
      const pixel=await sharp(frame).extract({left:10,top:300,width:1,height:1}).raw().toBuffer();
      if(color==='blue'){expect(pixel[2]).toBeGreaterThan(220);expect(pixel[0]).toBeLessThan(30);}
      if(color==='yellow'){expect(pixel[0]).toBeGreaterThan(220);expect(pixel[1]).toBeGreaterThan(220);expect(pixel[2]).toBeLessThan(30);}
      if(color==='green'){expect(pixel[1]).toBeGreaterThan(90);expect(pixel[0]).toBeLessThan(30);}
      if(color==='red'){expect(pixel[0]).toBeGreaterThan(220);expect(pixel[1]).toBeLessThan(30);}
      for(const region of [{left:0,top:540,width:720,height:180},{left:360,top:0,width:360,height:180}]){
        const raster=await sharp(frame).extract(region).removeAlpha().raw().toBuffer();let white=0;
        for(let i=0;i<raster.length;i+=3)if(raster[i]!>220&&raster[i+1]!>220&&raster[i+2]!>220)white++;
        expect(white).toBeGreaterThan(100);
      }
    }
    const decoded=await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});
    const tone=(frequency:number)=>{let real=0,imaginary=0;for(let i=24000;i<28800;i++){const sample=decoded.stdout.readFloatLE(i*4),phase=2*Math.PI*frequency*i/48000;real+=sample*Math.cos(phase);imaginary+=sample*Math.sin(phase);}return 2*Math.hypot(real,imaginary)/4800;};
    expect(tone(440)).toBeGreaterThan(.04);expect(tone(880)).toBeGreaterThan(.002);expect(tone(1760)).toBeLessThan(.001);
    for(const invalid of [[],[clips[1]!,clips[0]!],[clips[0]!,{...clips[1]!,startMs:150}],[...clips,clips[0]!],[clips[0]!,{...clips[1]!,endMs:1100}],[clips[0]!,{...clips[1]!,sourceStartMs:950}]])await expect(processor.process({bytes,brollClips:invalid,options},context())).rejects.toThrow('INVALID_INPUT');
    await expect(processor.process({bytes,broll:clips[0],brollClips:clips,options},context())).rejects.toThrow('INVALID_INPUT');
  });
  it.each([false,true])('blends B-roll edges with the main picture while keeping decorations, sound and bookends (collection=%s)',async collection=>{
    const clipFile=join(directory,`fade-source-${collection}.mp4`),musicFile=join(directory,`fade-music-${collection}.mp3`);
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','color=c=yellow:s=320x240:r=30:d=1','-f','lavfi','-i','sine=frequency=1760:duration=1','-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=blue:t=fill:enable='gte(t,0.4)'",'-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',clipFile]);
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','sine=frequency=880:duration=0.25','-ac','2','-ar','48000','-c:a','libmp3lame',musicFile]);
    const clipBytes=await readFile(clipFile),clip={bytes:clipBytes,startMs:200,endMs:800,sourceStartMs:400,fadeMs:200},bookend={bytes:clipBytes,sourceStartMs:0,durationMs:300};
    const options=videoProcessingSchema.parse({orientation:'1:1',resolution:'720p',captions:[{start:0,end:.9,text:'SUBTITLE'}],watermark:{text:'BRAND',position:'TOP_RIGHT',opacity:100}});
    const output=await processor.process({bytes,...(collection?{brollClips:[clip]}:{broll:clip}),bookends:{intro:bookend,outro:bookend},backgroundMusic:{bytes:await readFile(musicFile),volumePercent:20},options},context());
    expect(Math.abs(output.durationSeconds-1.6)).toBeLessThan(.1);
    const file=join(directory,`faded-${collection}.mp4`);await writeFile(file,output.bytes);
    for(const time of [.1,.3,.5,.7,.9]){
      const frame=join(directory,`fade-${collection}-${time}.png`);await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-ss',String(time+.3),'-i',file,'-frames:v','1','-update','1',frame]);
      const pixel=await sharp(frame).extract({left:10,top:300,width:1,height:1}).raw().toBuffer();
      if(time===.1){expect(pixel[1]).toBeGreaterThan(90);expect(pixel[2]).toBeLessThan(30);}
      if(time===.3){expect(pixel[1]).toBeGreaterThan(30);expect(pixel[1]).toBeLessThan(105);expect(pixel[2]).toBeGreaterThan(70);expect(pixel[2]).toBeLessThan(190);}
      if(time===.5){expect(pixel[2]).toBeGreaterThan(220);expect(pixel[0]).toBeLessThan(30);}
      if(time===.7){expect(pixel[0]).toBeGreaterThan(70);expect(pixel[0]).toBeLessThan(190);expect(pixel[2]).toBeGreaterThan(70);expect(pixel[2]).toBeLessThan(190);}
      if(time===.9){expect(pixel[0]).toBeGreaterThan(220);expect(pixel[2]).toBeLessThan(30);}
      if(time===.3||time===.7)for(const region of [{left:0,top:540,width:720,height:180},{left:360,top:0,width:360,height:180}]){
        const raster=await sharp(frame).extract(region).removeAlpha().raw().toBuffer();let white=0;
        for(let i=0;i<raster.length;i+=3)if(raster[i]!>220&&raster[i+1]!>220&&raster[i+2]!>220)white++;
        expect(white).toBeGreaterThan(100);
      }
    }
    const decoded=await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],{encoding:'buffer',maxBuffer:1024*1024});
    const tone=(frequency:number)=>{let real=0,imaginary=0;for(let i=28800;i<33600;i++){const sample=decoded.stdout.readFloatLE(i*4),phase=2*Math.PI*frequency*i/48000;real+=sample*Math.cos(phase);imaginary+=sample*Math.sin(phase);}return 2*Math.hypot(real,imaginary)/4800;};
    expect(tone(440)).toBeGreaterThan(.04);expect(tone(880)).toBeGreaterThan(.002);expect(tone(1760)).toBeLessThan(.001);
    for(const fadeMs of [0,99,301,2001])await expect(processor.process({bytes,broll:{...clip,fadeMs},options},context())).rejects.toThrow('INVALID_INPUT');
  },90_000); // Includes rendering, five frame decodes, audio analysis and four invalid-input probes through Docker.
  it('returns to the main picture at the shared boundary of adjacent faded inserts',async()=>{
    const clipFile=join(directory,'adjacent-fades.mp4');
    await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=320x240:r=30:d=1','-vf',"drawbox=x=0:y=0:w=iw:h=ih:color=yellow:t=fill:enable='gte(t,0.4)'",'-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',clipFile]);
    const source=await readFile(clipFile),output=await processor.process({bytes,brollClips:[{bytes:source,startMs:100,endMs:500,sourceStartMs:0,fadeMs:100},{bytes:source,startMs:500,endMs:900,sourceStartMs:500,fadeMs:100}],options:videoProcessingSchema.parse({orientation:'1:1',resolution:'720p'})},context());
    const file=join(directory,'adjacent-fades-final.mp4');await writeFile(file,output.bytes);expect(Math.abs(output.durationSeconds-1)).toBeLessThan(.1);
    for(const [time,color] of [[.3,'blue'],[.5,'red'],[.7,'yellow'],[.95,'red']] as const){
      const frame=join(directory,`adjacent-fade-${time}.png`);await promisify(execFile)(ffmpeg!,['-nostdin','-v','error','-ss',String(time),'-i',file,'-frames:v','1','-update','1',frame]);
      const pixel=await sharp(frame).extract({left:10,top:300,width:1,height:1}).raw().toBuffer();
      if(color==='blue'){expect(pixel[2]).toBeGreaterThan(220);expect(pixel[0]).toBeLessThan(30);}
      if(color==='red'){expect(pixel[0]).toBeGreaterThan(220);expect(pixel[1]).toBeLessThan(30);expect(pixel[2]).toBeLessThan(30);}
      if(color==='yellow'){expect(pixel[0]).toBeGreaterThan(220);expect(pixel[1]).toBeGreaterThan(220);expect(pixel[2]).toBeLessThan(30);}
    }
  });
  it('extracts bounded mono PCM WAV for transcription',async()=>{const audio=await processor.prepareAudio(bytes,context());expect(Buffer.from(audio.bytes.subarray(0,4)).toString()).toBe('RIFF');expect(Buffer.from(audio.bytes.subarray(8,12)).toString()).toBe('WAVE');expect(audio.bytes.length).toBeLessThan(6000000);expect(audio.durationSeconds).toBeGreaterThan(.8);});
  it('fails closed for missing binaries and honors cancellation',async()=>{
    await expect(new FFmpegVideoProcessor('/nonexistent/ffmpeg','/nonexistent/ffprobe').process({bytes,options:videoProcessingSchema.parse({})},context())).rejects.toThrow('CONFIGURATION_REQUIRED');
    const abort=new AbortController();abort.abort();await expect(processor.process({bytes,options:videoProcessingSchema.parse({})},{...context(),signal:abort.signal})).rejects.toThrow();
  });
});
