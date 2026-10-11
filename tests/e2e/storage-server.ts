// Loopback S3 transport fixture for Playwright. No production imports or credentials.
import sharp from 'sharp';
import { createServer } from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
if (process.env.NODE_ENV !== 'test') throw new Error('Storage fixture requires NODE_ENV=test');
if(!process.env.MOCK_VIDEO_FILE||!process.env.FFMPEG_PATH)throw new Error('Video fixture configuration required');
await promisify(execFile)(process.env.FFMPEG_PATH,['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=green:s=320x240:r=30:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-map','0:v','-map','1:a','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-shortest','-movflags','+faststart',process.env.MOCK_VIDEO_FILE]);
if(process.env.MOCK_IMAGE_FILE)for(const [width,height] of [[1024,1024],[1024,1536],[1536,1024]])await sharp({create:{width:width!,height:height!,channels:3,background:'#aacdbf'}}).png().toFile(process.env.MOCK_IMAGE_FILE.replace('{size}',`${width}x${height}`));
const objects = new Map<string,{bytes:Buffer;mime:string}>();
const server = createServer(async(request,response)=>{
  const path = new URL(request.url ?? '/', 'http://127.0.0.1:8027').pathname;
  if (path === '/health') {response.end('ok');return;}
  if (!/^\/contentos-e2e\/[a-f0-9-]+\/(?:images\/[a-f0-9-]+\.jpg|[a-f0-9-]+\/photos\/[a-f0-9-]+\.jpg|videos\/[a-f0-9-]+\/(?:original\.mp4|final\.mp4|cover\.jpg|covers\/[a-f0-9-]+\.jpg))$/.test(path)) {response.writeHead(404);response.end();return;}
  try {
    if (request.method === 'PUT') {
      const chunks:Buffer[]=[];let size=0;
      for await (const chunk of request) {const bytes=Buffer.from(chunk);size+=bytes.byteLength;if(size>256*1024*1024){response.writeHead(413);response.end();return;}chunks.push(bytes);}
      objects.set(path,{bytes:Buffer.concat(chunks),mime:request.headers['content-type']??'application/octet-stream'});response.writeHead(200,{ETag:'"fixture"'});response.end();return;
    }
    if (request.method === 'DELETE') {objects.delete(path);response.writeHead(204);response.end();return;}
    const object=objects.get(path);if(!object){response.writeHead(404);response.end();return;}
    response.writeHead(200,{'Content-Type':object.mime,'Content-Length':object.bytes.byteLength,'Cache-Control':'no-store'});response.end(request.method==='HEAD'?undefined:object.bytes);
  } catch {response.writeHead(500);response.end();}
});
server.listen(8027,'127.0.0.1');
process.on('SIGTERM',()=>server.close());process.on('SIGINT',()=>server.close());
