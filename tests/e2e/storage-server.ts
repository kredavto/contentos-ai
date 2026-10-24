// Loopback S3 transport fixture for Playwright. No production imports or credentials.
import sharp from 'sharp';
import { createServer } from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
if (process.env.NODE_ENV !== 'test') throw new Error('Storage fixture requires NODE_ENV=test');
if(!process.env.MOCK_VIDEO_FILE||!process.env.FFMPEG_PATH)throw new Error('Video fixture configuration required');
await promisify(execFile)(process.env.FFMPEG_PATH,['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=green:s=320x240:r=30:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-map','0:v','-map','1:a','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-shortest','-movflags','+faststart',process.env.MOCK_VIDEO_FILE]);
if(process.env.MOCK_IMAGE_FILE)for(const [width,height] of [[1024,1024],[1024,1536],[1536,1024]])await sharp({create:{width:width!,height:height!,channels:3,background:'#aacdbf'}}).png().toFile(process.env.MOCK_IMAGE_FILE.replace('{size}',`${width}x${height}`));
const objects = new Map<string,{bytes:Buffer;mime:string}>();
const server = createServer(async(request,response)=>{
  const path = new URL(request.url ?? '/', 'http://127.0.0.1:8027').pathname;
  if (path === '/health') {response.end('ok');return;}
  if(path==='/contentos-e2e'&&request.method==='POST'){
    try{
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of request){const bytes=Buffer.from(chunk);size+=bytes.byteLength;if(size>65*1024*1024)throw new Error('Fixture upload too large');chunks.push(bytes);}
      const form=await new Request('http://localhost',{method:'POST',headers:{'Content-Type':request.headers['content-type']??''},body:Buffer.concat(chunks)}).formData();
      const field=(key:string)=>{const value=form.get(key);if(typeof value!=='string')throw new Error('Missing field');return value;};
      const key=field('key'),mime=field('Content-Type'),file=form.get('file'),policyText=field('Policy');
      if(!/^[a-f0-9-]+\/uploads\/[a-f0-9-]+\/source$/.test(key)||!(file instanceof File))throw new Error('Invalid source');
      const policy=JSON.parse(Buffer.from(policyText,'base64').toString()) as {expiration:string;conditions:(Record<string,string>|[string,number,number])[]};
      if(Date.parse(policy.expiration)<=Date.now())throw new Error('Expired policy');
      for(const condition of policy.conditions){
        if(Array.isArray(condition)){if(condition[0]!=='content-length-range'||file.size<condition[1]||file.size>condition[2])throw new Error('Invalid size');}
        else for(const [name,value] of Object.entries(condition))if((name==='bucket'?'contentos-e2e':field(name))!==value)throw new Error('Policy mismatch');
      }
      const scope=field('X-Amz-Credential').split('/'),hmac=(key:string|Buffer,value:string)=>createHmac('sha256',key).update(value).digest();
      const signing=hmac(hmac(hmac(hmac('AWS4fixture-secret-not-a-credential',scope[1]!),scope[2]!),scope[3]!),scope[4]!);
      if(!timingSafeEqual(hmac(signing,policyText),Buffer.from(field('X-Amz-Signature'),'hex')))throw new Error('Invalid signature');
      objects.set(`/contentos-e2e/${key}`,{bytes:Buffer.from(await file.arrayBuffer()),mime});response.writeHead(204);response.end();
    }catch{response.writeHead(403);response.end();}
    return;
  }
  if (!/^\/contentos-e2e\/[a-f0-9-]+\/(?:uploads\/[a-f0-9-]+\/(?:source|chunks\/(?:[0-9]|1[0-9]|2[01]))|library\/[a-f0-9-]+\/[1-3]\.(?:mp4|mp3)|images\/[a-f0-9-]+\.jpg|[a-f0-9-]+\/photos\/[a-f0-9-]+\.jpg|videos\/[a-f0-9-]+\/(?:original\.mp4|final\.mp4|cover\.jpg|covers\/[a-f0-9-]+\.jpg))$/.test(path)) {response.writeHead(404);response.end();return;}
  try {
    if (request.method === 'PUT') {
      const chunks:Buffer[]=[];let size=0;
      for await (const chunk of request) {const bytes=Buffer.from(chunk);size+=bytes.byteLength;if(size>256*1024*1024){response.writeHead(413);response.end();return;}chunks.push(bytes);}
      objects.set(path,{bytes:Buffer.concat(chunks),mime:request.headers['content-type']??'application/octet-stream'});response.writeHead(200,{ETag:'"fixture"'});response.end();return;
    }
    if (request.method === 'DELETE') {objects.delete(path);response.writeHead(204);response.end();return;}
    const object=objects.get(path);if(!object){response.writeHead(404);response.end();return;}
    const etag='"'+createHash('sha256').update(object.bytes).digest('hex')+'"';
    if(request.headers['if-match']&&request.headers['if-match']!==etag){response.writeHead(412);response.end();return;}
    const headers={'Content-Type':object.mime,'Content-Length':object.bytes.byteLength,'Cache-Control':'no-store',ETag:etag,'Accept-Ranges':'bytes'};
    if(request.method==='GET'&&request.headers.range){
      const range=/^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
      const suffix=range?.[1]===''&&range[2]!=='';
      const start=suffix?Math.max(0,object.bytes.length-Number(range?.[2])):Number(range?.[1]);
      const end=suffix||range?.[2]===''?object.bytes.length-1:Math.min(Number(range?.[2]),object.bytes.length-1);
      if(!range||(!range[1]&&!range[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=object.bytes.length){response.writeHead(416,{'Content-Range':`bytes */${object.bytes.length}`});response.end();return;}
      response.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${object.bytes.length}`});response.end(object.bytes.subarray(start,end+1));return;
    }
    response.writeHead(200,headers);response.end(request.method==='HEAD'?undefined:object.bytes);
  } catch {response.writeHead(500);response.end();}
});
server.listen(8027,'127.0.0.1');
process.on('SIGTERM',()=>server.close());process.on('SIGINT',()=>server.close());
