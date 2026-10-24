// Runs inside the built worker image; all media is synthetic and temporary.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp,readFile,rm,access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import { FFmpegVideoProcessor } from '@contentos/providers';
import { videoProcessingSchema } from '@contentos/types';
assert.notEqual(process.getuid?.(),0);
await assert.rejects(access('/app/.env'));
await assert.rejects(access('/app/node_modules/.bin/vitest'));
const directory=await mkdtemp(join(tmpdir(),'contentos-container-smoke-'));
try{
  const source=join(directory,'source.mp4');
  await promisify(execFile)('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=c=green:s=320x240:r=30:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-map','0:v','-map','1:a','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-shortest','-movflags','+faststart',source]);
  const bytes=await readFile(source),processor=new FFmpegVideoProcessor('/usr/bin/ffmpeg','/usr/bin/ffprobe');
  const context={tenantId:randomUUID(),internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:randomUUID(),signal:globalThis.AbortSignal.timeout(60000)};
  const result=await processor.process({bytes,options:videoProcessingSchema.parse({orientation:'9:16',resolution:'720p',captions:[{start:0,end:0.8,text:'Проверка контейнера'}]})},context);
  assert.equal(result.width,720);assert.equal(result.height,1280);assert.equal(Buffer.from(result.bytes.subarray(4,8)).toString(),'ftyp');assert.deepEqual([...result.thumbnail.subarray(0,3)],[255,216,255]);
  const audio=await processor.prepareAudio(bytes,context);assert.equal(Buffer.from(audio.bytes.subarray(0,4)).toString(),'RIFF');
  console.info('Worker image: non-root, no runtime env/dev test runner, video/captions/cover/audio processing passed.');
}finally{await rm(directory,{recursive:true,force:true});}
