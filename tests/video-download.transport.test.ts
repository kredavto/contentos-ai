import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {RequestOptions,IncomingMessage} from 'node:http';
import {beforeEach,describe,it,expect,vi} from 'vitest';
const transport=vi.hoisted(()=>({resolve:vi.fn(),request:vi.fn()}));
vi.mock('node:dns/promises',()=>({resolve4:transport.resolve}));
vi.mock('node:https',()=>({request:transport.request}));
import {downloadProviderVideo} from '../packages/providers/src/video-download';
const context=()=>({tenantId:'fixture',internalId:'fixture',idempotencyKey:'fixture',correlationId:'fixture',signal:new AbortController().signal});
function respond(status:number,headers:Record<string,string>,bytes:Buffer){
  transport.request.mockImplementation((_url:URL,_options:RequestOptions,callback:(response:IncomingMessage)=>void)=>{
    const response=Object.assign(new PassThrough(),{statusCode:status,headers});
    return Object.assign(new EventEmitter(),{end(){queueMicrotask(()=>{callback(response as unknown as IncomingMessage);if(!response.destroyed)response.end(bytes);});}});
  });
}
describe('bounded pinned video transport',()=>{
  beforeEach(()=>{vi.clearAllMocks();transport.resolve.mockResolvedValue(['8.8.8.8']);});
  it('pins the checked address, retains the TLS hostname and sends no API credentials',async()=>{
    const bytes=Buffer.from([0,0,0,20,...Buffer.from('ftypisom'),0,0,0,0]);respond(200,{},bytes);
    expect(await downloadProviderVideo('https://files.heygen.ai/video.mp4?signature=fixture',context())).toEqual(bytes);
    const [url,options]=transport.request.mock.calls[0] as [URL,RequestOptions];
    expect(url.hostname).toBe('files.heygen.ai');expect(options.agent).toBe(false);expect(options.family).toBe(4);
    expect(options.headers).toEqual({Accept:'video/mp4','Accept-Encoding':'identity'});
    const callback=vi.fn();(options.lookup as (host:string,options:object,cb:typeof callback)=>void)('files.heygen.ai',{},callback);
    expect(callback).toHaveBeenCalledWith(null,'8.8.8.8',4);
  });
  it('rejects mixed public/private DNS and does not make a request',async()=>{
    transport.resolve.mockResolvedValue(['8.8.8.8','127.0.0.1']);
    await expect(downloadProviderVideo('https://files.heygen.ai/a',context())).rejects.toThrow('INVALID_MEDIA');expect(transport.request).not.toHaveBeenCalled();
  });
  it('rejects redirect, oversized, encoded and invalid-container responses',async()=>{
    respond(302,{location:'http://127.0.0.1/private'},Buffer.alloc(0));await expect(downloadProviderVideo('https://files.heygen.ai/a',context())).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(transport.request).toHaveBeenCalledTimes(1);
    for(const headers of [{'content-length':'268435457'},{'content-encoding':'gzip'}] as Record<string,string>[]){respond(200,headers,Buffer.alloc(0));await expect(downloadProviderVideo('https://files.heygen.ai/a',context())).rejects.toThrow('INVALID_MEDIA');}
    respond(200,{},Buffer.from('#EXTM3U\nhttp://127.0.0.1/private'));await expect(downloadProviderVideo('https://files.heygen.ai/a',context())).rejects.toThrow('INVALID_MEDIA');
  });
  it('does not resolve or request media after cancellation',async()=>{
    await expect(downloadProviderVideo('https://files.heygen.ai/a',{...context(),signal:AbortSignal.abort()})).rejects.toThrow('PROVIDER_UNAVAILABLE');expect(transport.resolve).not.toHaveBeenCalled();expect(transport.request).not.toHaveBeenCalled();
  });
});
