import {resolve4} from 'node:dns/promises';
import {request} from 'node:https';
import {isIPv4} from 'node:net';
import {DomainError,type OperationContext} from '@contentos/types';

const maxBytes=256*1024*1024;
/** Conservative IPv4 egress policy; IPv6-only destinations fail closed. */
export function isPublicVideoAddress(address:string):boolean {
  if(!isIPv4(address))return false;
  const [a,b]=address.split('.').map(Number) as [number,number,number,number];
  return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===0||b===168))||(a===198&&(b===18||b===19||b===51))||(a===203&&b===0));
}
export function checkedVideoUrl(value:string,hosts:readonly string[]):URL {
  let url:URL;try{url=new URL(value);}catch{throw new DomainError('INVALID_MEDIA',422);}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')||!hosts.includes(url.hostname))throw new DomainError('INVALID_MEDIA',422);
  return url;
}
/** Signed provider URLs never receive API credentials. No redirects or DNS rebinding. */
export async function downloadProviderVideo(value:string,context:OperationContext,hosts:readonly string[]=['files.heygen.ai']):Promise<Uint8Array> {
  const url=checkedVideoUrl(value,hosts);
  const signal=AbortSignal.any([context.signal,AbortSignal.timeout(120_000)]);
  try {
    signal.throwIfAborted();
    const addresses=await resolve4(url.hostname);
    signal.throwIfAborted();
    if(!addresses.length||addresses.some(address=>!isPublicVideoAddress(address)))throw new DomainError('INVALID_MEDIA',422);
    const address=addresses[0]!;
    return await new Promise<Uint8Array>((resolve,reject)=>{
      const req=request(url,{method:'GET',agent:false,signal,family:4,lookup:(_hostname,_options,callback)=>callback(null,address,4),headers:{Accept:'video/mp4','Accept-Encoding':'identity'}},response=>{
        if(response.statusCode!==200){response.resume();reject(new DomainError('PROVIDER_UNAVAILABLE',503));return;}
        const declared=Number(response.headers['content-length']);
        if((response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')||(Number.isFinite(declared)&&declared>maxBytes)){response.destroy();reject(new DomainError('INVALID_MEDIA',422));return;}
        const chunks:Buffer[]=[];let size=0;
        response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxBytes){response.destroy(new DomainError('INVALID_MEDIA',422));return;}chunks.push(chunk);});
        response.on('error',reject);
        response.on('end',()=>{const bytes=Buffer.concat(chunks);if(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp'){reject(new DomainError('INVALID_MEDIA',422));return;}resolve(bytes);});
      });
      req.on('error',reject);req.end();
    });
  }catch(error){if(error instanceof DomainError)throw error;throw new DomainError('PROVIDER_UNAVAILABLE',503);}
}
