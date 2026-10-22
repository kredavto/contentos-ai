import {describe,it,expect} from 'vitest';
import {readLibrarySource} from '../apps/web/src/server/library-upload';
import {maxBrowserMediaBytes} from '../packages/types/src/media-preparation';

describe('bounded same-origin library upload',()=>{
  const request=(bytes:Uint8Array,headers:Record<string,string>={})=>new Request('http://localhost/source',{method:'POST',headers:{'content-type':'audio/wav',...headers},body:Buffer.from(bytes)});
  it('accepts the boundary size without encoding file bytes as JSON',async()=>{
    const bytes=Buffer.alloc(maxBrowserMediaBytes,7);
    const result=await readLibrarySource(request(bytes,{'content-length':String(bytes.length)}));
    expect(result.mimeType).toBe('audio/wav');expect(Buffer.from(result.bytes).equals(bytes)).toBe(true);
  });
  it('rejects oversized declared and actual bodies, truncated content and unsupported MIME',async()=>{
    await expect(readLibrarySource(request(Buffer.alloc(12),{'content-length':String(maxBrowserMediaBytes+1)}))).rejects.toMatchObject({status:413});
    await expect(readLibrarySource(request(Buffer.alloc(maxBrowserMediaBytes+1)))).rejects.toMatchObject({status:413});
    await expect(readLibrarySource(request(Buffer.alloc(12),{'content-length':'13'}))).rejects.toMatchObject({status:422});
    await expect(readLibrarySource(request(Buffer.alloc(11)))).rejects.toMatchObject({status:422});
    await expect(readLibrarySource(request(Buffer.alloc(12),{'content-type':'text/html'}))).rejects.toThrow();
  });
  it('accepts a one-byte final chunk but never an empty chunk',async()=>{
    const result=await readLibrarySource(request(Buffer.from([7])),1);expect(result.bytes[0]).toBe(7);
    await expect(readLibrarySource(request(Buffer.alloc(0)),1)).rejects.toMatchObject({status:422});
  });
});
