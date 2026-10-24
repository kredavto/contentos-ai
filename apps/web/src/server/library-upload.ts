import {DomainError,maxBrowserMediaBytes,mediaSourceMimeSchema} from '@contentos/types';

export async function readLibrarySource(request:Request,minimumBytes=12){
  const mimeType=mediaSourceMimeSchema.parse(request.headers.get('content-type'));
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBrowserMediaBytes))throw new DomainError('INVALID_MEDIA',413);
  const reader=request.body?.getReader();if(!reader)throw new DomainError('INVALID_MEDIA',422);
  const chunks:Uint8Array[]=[];let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>maxBrowserMediaBytes)throw new DomainError('INVALID_MEDIA',413);
      chunks.push(value);
    }
  }finally{await reader.cancel();}
  if(size<minimumBytes||(declared!==null&&size!==Number(declared)))throw new DomainError('INVALID_MEDIA',422);
  return {mimeType,bytes:new Uint8Array(Buffer.concat(chunks,size))};
}
