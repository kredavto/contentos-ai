import {createHash,randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {LibraryMediaRepository,libraryOutputKey,libraryChunkKey} from '../../packages/db/src/index';
import {LibraryMediaService,LibraryMediaProcessor} from '../../packages/core/src/library-media';
import {DomainError,maxBrowserMediaBytes,maxMediaSourceBytes,libraryUploadSchema,type StorageProvider,type DirectUploadProvider,type MediaPreparationProvider} from '../../packages/types/src/index';
import {isolatedTestDatabase} from '../helpers/isolated-database';

const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable audio/video library',()=>{
  const database=isolatedTestDatabase(url),repo=new LibraryMediaRepository(database.db);
  async function fixture(){
    const tenantId=randomUUID(),userId=randomUUID(),viewerId=randomUUID(),editorId=randomUUID(),workspaceId=randomUUID(),brandId=randomUUID(),otherBrand=randomUUID(),correlationId=randomUUID(),provider=`fixture-${tenantId}`;
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${userId},${`${userId}@example.test`},'unusable','Owner',now()),(${viewerId},${`${viewerId}@example.test`},'unusable','Viewer',now()),(${editorId},${`${editorId}@example.test`},'unusable','Editor',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Library tests')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${userId},'OWNER'),(${tenantId},${viewerId},'VIEWER'),(${tenantId},${editorId},'EDITOR')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspaceId},${tenantId},'Workspace')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brandId},${tenantId},${workspaceId},'Library'),(${otherBrand},${tenantId},${workspaceId},'Other brand')`;
    const source=Buffer.from('fixture audio source bytes'),objects=new Map<string,Uint8Array>();
    let writes=0,preparations=0,failGet=false,failDelete=false;
    let onPut:(()=>Promise<void>)|undefined,onPrepare:(()=>Promise<void>)|undefined;
    const storage:StorageProvider&DirectUploadProvider={
      signedUpload:async input=>({url:'https://storage.example.test',fields:{key:input.key},expiresInSeconds:input.expiresSeconds}),
      get:async(key,max)=>{if(failGet)throw new DomainError('PROVIDER_UNAVAILABLE',503);const bytes=objects.get(key);if(!bytes)throw new DomainError('PROVIDER_UNAVAILABLE',503);if(bytes.byteLength>max)throw new DomainError('INVALID_MEDIA',422);return bytes;},
      put:async(key,bytes)=>{writes++;objects.set(key,bytes);await onPut?.();},
      delete:async key=>{if(failDelete)throw new DomainError('PROVIDER_UNAVAILABLE',503);objects.delete(key);},
      signedDownload:async key=>`https://storage.example.test/${key}`,
    };
    const renderer:MediaPreparationProvider={prepare:async()=>{preparations++;await onPrepare?.();return {bytes:Buffer.alloc(32),mimeType:'audio/mpeg',durationMs:1000,width:null,height:null,hasAudio:true};}};
    const service=new LibraryMediaService(repo,storage,true,provider),processor=new LibraryMediaProcessor(repo,storage,renderer,true,provider);
    const input=()=>({name:'Fictional music.wav',source:{mimeType:'audio/wav' as const,bytes:source.length,sha256:createHash('sha256').update(source).digest('hex')},idempotencyKey:randomUUID()});
    const row=async(id:string)=>(await database.client`select * from library_media where tenant_id=${tenantId} and id=${id}`)[0]!;
    async function begin(){const request=input(),result=await service.begin(userId,tenantId,brandId,request,correlationId);objects.set(result.upload!.fields.key!,source);return {...result,request};}
    async function queued(){const asset=await begin();await service.confirm(userId,tenantId,brandId,asset.id);return asset;}
    async function cleanupNow(id:string){await database.client`update library_media set cleanup_after=now(),cleanup_expires_at=null where tenant_id=${tenantId} and id=${id}`;return processor.cleanupOne();}
    return {tenantId,userId,viewerId,editorId,brandId,otherBrand,correlationId,provider,source,objects,storage,renderer,service,processor,input,row,begin,queued,cleanupNow,
      writes:()=>writes,preparations:()=>preparations,failGet:(value:boolean)=>{failGet=value;},failDelete:(value:boolean)=>{failDelete=value;},onPut:(hook:()=>Promise<void>)=>{onPut=hook;},onPrepare:(hook:()=>Promise<void>)=>{onPrepare=hook;}};
  }
  function chunkInput(f:Awaited<ReturnType<typeof fixture>>,bytes:Buffer){
    const chunkHashes:string[]=[];
    for(let start=0;start<bytes.length;start+=maxBrowserMediaBytes)chunkHashes.push(createHash('sha256').update(bytes.subarray(start,start+maxBrowserMediaBytes)).digest('hex'));
    return {...f.input(),source:{mimeType:'audio/wav' as const,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},chunkHashes};
  }
  it('receipts concurrent chunks once, gates confirmation and prepares the exact assembled source',async()=>{
    const f=await fixture(),bytes=Buffer.alloc(maxBrowserMediaBytes+1,7),input=chunkInput(f,bytes);
    const asset=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,input,f.correlationId);
    expect(Date.parse(asset.expiresAt)-Date.now()).toBeGreaterThan(29*60_000);
    const send=(index:number)=>f.service.uploadChunk(f.userId,f.tenantId,f.brandId,asset.id,index,bytes.subarray(index*maxBrowserMediaBytes,(index+1)*maxBrowserMediaBytes),'audio/wav');
    await Promise.all([send(0),send(0)]);
    expect((await f.service.resumeUpload(f.userId,f.tenantId,f.brandId,asset.id)).uploadedChunks).toEqual([0]);
    await expect(f.service.confirm(f.userId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('CONFLICT');
    await send(1);const writes=f.writes();await send(0);expect(f.writes()).toBe(writes);
    const replay=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,input,f.correlationId);expect(replay.uploadedChunks).toEqual([0,1]);
    await Promise.all([f.service.confirm(f.userId,f.tenantId,f.brandId,asset.id),f.service.confirm(f.userId,f.tenantId,f.brandId,asset.id)]);
    const spy=vi.spyOn(f.renderer,'prepare');await f.processor.run(f.tenantId,asset.id);
    expect(Buffer.from(spy.mock.calls[0]![0].bytes).equals(bytes)).toBe(true);
    expect(await f.row(asset.id)).toMatchObject({status:'READY',attempt:1});
    await f.cleanupNow(asset.id);expect(f.objects.size).toBe(1);
    await f.service.delete(f.userId,f.tenantId,f.brandId,asset.id,f.correlationId);await f.cleanupNow(asset.id);
    expect(f.objects.size).toBe(0);expect(await f.row(asset.id)).toMatchObject({status:'DELETED',chunk_hashes:['0'.repeat(64),'0'.repeat(64)],uploaded_chunks:[]});
  });
  it('validates chunk manifests, content, access and transport mode before writing storage',async()=>{
    const f=await fixture(),bytes=Buffer.alloc(maxBrowserMediaBytes+1,7),input=chunkInput(f,bytes);
    expect(libraryUploadSchema.safeParse({...input,chunkHashes:[input.chunkHashes[0]]}).success).toBe(false);
    await expect(f.service.begin(f.userId,f.tenantId,f.brandId,input,f.correlationId)).rejects.toThrow('INVALID_INPUT');
    const asset=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,input,f.correlationId);
    await expect(f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,{...input,chunkHashes:['0'.repeat(64),input.chunkHashes[1]]},f.correlationId)).rejects.toThrow('CONFLICT');
    await expect(f.service.authorizeSource(f.userId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('CONFLICT');
    await expect(f.service.uploadSource(f.userId,f.tenantId,f.brandId,asset.id,bytes,'audio/wav')).rejects.toThrow('CONFLICT');
    await expect(f.service.authorizeChunk(f.editorId,f.tenantId,f.brandId,asset.id,0)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(f.service.authorizeChunk(f.viewerId,f.tenantId,f.brandId,asset.id,0)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(f.service.authorizeChunk(f.userId,f.tenantId,f.otherBrand,asset.id,0)).rejects.toThrow('NOT_FOUND');
    const other=await fixture();await expect(other.service.authorizeChunk(other.userId,other.tenantId,other.brandId,asset.id,0)).rejects.toThrow('NOT_FOUND');
    for(const index of [-1,2,22,1.5])await expect(f.service.authorizeChunk(f.userId,f.tenantId,f.brandId,asset.id,index)).rejects.toThrow();
    await expect(f.service.uploadChunk(f.userId,f.tenantId,f.brandId,asset.id,1,Buffer.from([8]),'audio/wav')).rejects.toThrow('INVALID_MEDIA');
    await expect(f.service.uploadChunk(f.userId,f.tenantId,f.brandId,asset.id,1,Buffer.from([7]),'video/mp4')).rejects.toThrow('INVALID_MEDIA');
    await expect(f.service.uploadChunk(f.userId,f.tenantId,f.brandId,asset.id,0,Buffer.from([7]),'audio/wav')).rejects.toThrow('INVALID_MEDIA');
    expect(f.writes()).toBe(0);
    await expect(database.client`update library_media set uploaded_chunks=array[2] where id=${asset.id}`).rejects.toThrow();
    await expect(database.client`update library_media set chunk_hashes=array['bad','bad'] where id=${asset.id}`).rejects.toThrow();
    await database.client`update library_media set uploaded_chunks=array[0,0] where id=${asset.id}`;
    await expect(f.service.confirm(f.userId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('CONFLICT');
  });
  it('replays uncertain chunk PUTs safely and fences deletion and late writes',async()=>{
    const f=await fixture(),bytes=Buffer.alloc(12,7),input=chunkInput(f,bytes),asset=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,input,f.correlationId);
    f.onPut(async()=>{throw new DomainError('PROVIDER_UNAVAILABLE',503);});
    await expect(f.service.uploadChunk(f.userId,f.tenantId,f.brandId,asset.id,0,bytes,'audio/wav')).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect((await f.service.resumeUpload(f.userId,f.tenantId,f.brandId,asset.id)).uploadedChunks).toEqual([]);
    f.onPut(async()=>{});await f.service.uploadChunk(f.userId,f.tenantId,f.brandId,asset.id,0,bytes,'audio/wav');
    expect((await f.service.resumeUpload(f.userId,f.tenantId,f.brandId,asset.id)).uploadedChunks).toEqual([0]);
    const second=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,{...input,idempotencyKey:randomUUID()},f.correlationId);
    f.onPut(async()=>{await f.service.delete(f.userId,f.tenantId,f.brandId,second.id,f.correlationId);});
    await expect(f.service.uploadChunk(f.userId,f.tenantId,f.brandId,second.id,0,bytes,'audio/wav')).rejects.toThrow('CONFLICT');
    const row=await f.row(second.id);expect(new Date(row.cleanup_after).getTime()).toBeGreaterThanOrEqual(new Date(row.upload_expires_at).getTime()+60_000);
    const key=`${f.tenantId}/uploads/${second.id}/chunks/0`;await f.cleanupNow(second.id);expect(f.objects.has(key)).toBe(false);
    f.objects.set(key,bytes);await f.cleanupNow(second.id);expect(f.objects.has(key)).toBe(false);
  });
  it('checks chunk writer revocation and fixed expiry without recording incomplete work',async()=>{
    const f=await fixture(),bytes=Buffer.alloc(12,7),asset=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,chunkInput(f,bytes),f.correlationId);
    f.onPut(async()=>{await database.client`update organization_members set role='VIEWER' where tenant_id=${f.tenantId} and user_id=${f.userId}`;});
    await expect(f.service.uploadChunk(f.userId,f.tenantId,f.brandId,asset.id,0,bytes,'audio/wav')).rejects.toThrow('NOT_AUTHORIZED');
    expect(await f.row(asset.id)).toMatchObject({status:'UPLOADING',uploaded_chunks:[]});
    await database.client`update organization_members set role='OWNER' where tenant_id=${f.tenantId} and user_id=${f.userId}`;
    await database.client`update library_media set upload_expires_at=now()-interval '1 second' where id=${asset.id}`;
    await expect(f.service.uploadChunk(f.userId,f.tenantId,f.brandId,asset.id,0,bytes,'audio/wav')).rejects.toThrow('CONFLICT');
    await expect(f.service.resumeUpload(f.userId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('CONFLICT');
  });
  it('rechecks each stored chunk and the whole hash before decoding',async()=>{
    const f=await fixture(),bytes=Buffer.alloc(12,7);
    for(const corruptChunk of [true,false]){
      const input=chunkInput(f,bytes);if(!corruptChunk)input.source.sha256='0'.repeat(64);
      const asset=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,input,f.correlationId);
      await f.service.uploadChunk(f.userId,f.tenantId,f.brandId,asset.id,0,bytes,'audio/wav');await f.service.confirm(f.userId,f.tenantId,f.brandId,asset.id);
      if(corruptChunk)f.objects.set(`${f.tenantId}/uploads/${asset.id}/chunks/0`,Buffer.alloc(12,8));
      await f.processor.run(f.tenantId,asset.id);expect(await f.row(asset.id)).toMatchObject({status:'FAILED',error_code:'INVALID_MEDIA'});
    }
    expect(f.preparations()).toBe(0);
  });
  it('handles the full 64 MiB and 22-chunk boundary without an additional assembled storage object',async()=>{
    const f=await fixture(),bytes=Buffer.alloc(maxMediaSourceBytes,7),input=chunkInput(f,bytes);
    expect(input.chunkHashes).toHaveLength(22);
    const asset=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,input,f.correlationId);
    for(let index=0;index<input.chunkHashes.length;index++)await f.service.uploadChunk(f.userId,f.tenantId,f.brandId,asset.id,index,bytes.subarray(index*maxBrowserMediaBytes,(index+1)*maxBrowserMediaBytes),'audio/wav');
    const row=await repo.uploadSource(f.userId,f.tenantId,f.brandId,asset.id);expect(row.uploadedChunks).toHaveLength(22);expect(f.objects.has(libraryChunkKey(row,21))).toBe(true);expect(f.objects.has(row.sourceKey)).toBe(false);
    await f.service.confirm(f.userId,f.tenantId,f.brandId,asset.id);await f.processor.run(f.tenantId,asset.id);
    expect(await f.row(asset.id)).toMatchObject({status:'READY'});await f.cleanupNow(asset.id);expect(f.objects.size).toBe(1);
  });
  it('accepts browser sources, recovers a lost acknowledgement and never rewrites queued content',async()=>{
    const f=await fixture(),input=f.input(),asset=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,input,f.correlationId);
    expect(asset).not.toHaveProperty('upload');
    await expect(f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,input,f.correlationId)).resolves.toEqual(asset);
    f.onPut(async()=>{throw new DomainError('PROVIDER_UNAVAILABLE',503);});
    await expect(f.service.uploadSource(f.userId,f.tenantId,f.brandId,asset.id,f.source,'audio/wav')).rejects.toThrow('PROVIDER_UNAVAILABLE');
    expect(await f.row(asset.id)).toMatchObject({status:'UPLOADING'});
    f.onPut(async()=>{});
    await expect(f.service.uploadSource(f.userId,f.tenantId,f.brandId,asset.id,f.source,'audio/wav')).resolves.toMatchObject({status:'QUEUED'});
    const writes=f.writes();
    await expect(f.service.uploadSource(f.userId,f.tenantId,f.brandId,asset.id,f.source,'audio/wav')).resolves.toMatchObject({status:'QUEUED'});
    expect(f.writes()).toBe(writes);
    await f.processor.run(f.tenantId,asset.id);expect(await f.row(asset.id)).toMatchObject({status:'READY'});
  });
  it('rejects browser size/hash/MIME mismatches and actor, brand and tenant substitutions before storage',async()=>{
    const f=await fixture(),asset=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,f.input(),f.correlationId);
    await expect(f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,{...f.input(),source:{...f.input().source,bytes:maxBrowserMediaBytes+1}},f.correlationId)).rejects.toMatchObject({status:413});
    for(const [bytes,mime] of [[Buffer.alloc(f.source.length),'audio/wav'],[f.source,'video/mp4'],[f.source.subarray(0,12),'audio/wav']] as const)
      await expect(f.service.uploadSource(f.userId,f.tenantId,f.brandId,asset.id,bytes,mime)).rejects.toThrow('INVALID_MEDIA');
    await expect(f.service.authorizeSource(f.viewerId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(f.service.uploadSource(f.editorId,f.tenantId,f.brandId,asset.id,f.source,'audio/wav')).rejects.toThrow('NOT_AUTHORIZED');
    await expect(f.service.uploadSource(f.userId,f.tenantId,f.otherBrand,asset.id,f.source,'audio/wav')).rejects.toThrow('NOT_FOUND');
    const other=await fixture();
    await expect(other.service.uploadSource(other.userId,other.tenantId,other.brandId,asset.id,f.source,'audio/wav')).rejects.toThrow('NOT_FOUND');
    expect(f.writes()).toBe(0);
  });
  it('blocks browser writes after expiry and cleans an upload deleted while storage is in flight',async()=>{
    const f=await fixture(),expired=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,f.input(),f.correlationId);
    await database.client`update library_media set upload_expires_at=now()-interval '1 second' where id=${expired.id}`;
    await expect(f.service.uploadSource(f.userId,f.tenantId,f.brandId,expired.id,f.source,'audio/wav')).rejects.toThrow('CONFLICT');
    expect(f.writes()).toBe(0);
    const asset=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,f.input(),f.correlationId);
    f.onPut(async()=>{await f.service.delete(f.userId,f.tenantId,f.brandId,asset.id,f.correlationId);});
    await expect(f.service.uploadSource(f.userId,f.tenantId,f.brandId,asset.id,f.source,'audio/wav')).rejects.toThrow('CONFLICT');
    const row=await f.row(asset.id);expect(row.status).toBe('DELETE_PENDING');expect(new Date(row.cleanup_after).getTime()).toBeGreaterThanOrEqual(new Date(row.upload_expires_at).getTime()+60_000);
    expect(await f.processor.cleanupOne()).toBe(false);
    await f.cleanupNow(asset.id);expect(f.objects.size).toBe(0);expect(await f.row(asset.id)).toMatchObject({status:'DELETED'});
  });
  it('rechecks revoked permissions after a browser source write',async()=>{
    const f=await fixture(),asset=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,f.input(),f.correlationId);
    f.onPut(async()=>{await database.client`update organization_members set role='VIEWER' where tenant_id=${f.tenantId} and user_id=${f.userId}`;});
    await expect(f.service.uploadSource(f.userId,f.tenantId,f.brandId,asset.id,f.source,'audio/wav')).rejects.toThrow('NOT_AUTHORIZED');
    expect(await f.row(asset.id)).toMatchObject({status:'UPLOADING'});expect(await repo.claim(f.tenantId,asset.id,f.provider)).toBeNull();
  });
  it('recovers the original upload declaration only for its current authorized uploader',async()=>{
    const f=await fixture(),input=f.input(),asset=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,input,f.correlationId);
    const recovered=await f.service.resumeUpload(f.userId,f.tenantId,f.brandId,asset.id);
    expect(recovered).toMatchObject({id:asset.id,input});expect(Date.parse(recovered.expiresAt)).toBeGreaterThan(Date.now());
    const own=await f.service.overview(f.userId,f.tenantId,f.brandId);expect(own.assets[0]?.canResume).toBe(true);expect(own.assets[0]).not.toHaveProperty('sourceSha256');
    expect((await f.service.overview(f.editorId,f.tenantId,f.brandId)).assets[0]?.canResume).toBe(false);
    await expect(f.service.resumeUpload(f.editorId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(f.service.resumeUpload(f.viewerId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(f.service.resumeUpload(f.userId,f.tenantId,f.otherBrand,asset.id)).rejects.toThrow('NOT_FOUND');
    const other=await fixture();await expect(other.service.resumeUpload(other.userId,other.tenantId,other.brandId,asset.id)).rejects.toThrow('NOT_FOUND');
    await f.service.uploadSource(f.userId,f.tenantId,f.brandId,asset.id,f.source,'audio/wav');
    await expect(f.service.resumeUpload(f.userId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('CONFLICT');
    expect((await f.service.overview(f.userId,f.tenantId,f.brandId)).assets[0]?.canResume).toBe(false);
  });
  it('does not revive expired, deleted, oversized or configuration-disabled uploads',async()=>{
    const f=await fixture(),input=f.input(),asset=await f.service.beginBrowserUpload(f.userId,f.tenantId,f.brandId,input,f.correlationId);
    const disabled=new LibraryMediaService(repo,f.storage,false,f.provider);
    await expect(disabled.resumeUpload(f.userId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('CONFIGURATION_REQUIRED');
    await database.client`update library_media set upload_expires_at=now()-interval '1 second' where id=${asset.id}`;
    await expect(f.service.resumeUpload(f.userId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('CONFLICT');
    expect((await f.service.overview(f.userId,f.tenantId,f.brandId)).assets[0]?.canResume).toBe(false);
    const deleted=await f.begin();await f.service.delete(f.userId,f.tenantId,f.brandId,deleted.id,f.correlationId);
    await expect(f.service.resumeUpload(f.userId,f.tenantId,f.brandId,deleted.id)).rejects.toThrow('CONFLICT');
    const large=await f.service.begin(f.userId,f.tenantId,f.brandId,{...f.input(),source:{...input.source,bytes:maxBrowserMediaBytes+1}},f.correlationId);
    await expect(f.service.resumeUpload(f.userId,f.tenantId,f.brandId,large.id)).rejects.toThrow('CONFLICT');
    expect((await f.service.overview(f.userId,f.tenantId,f.brandId)).assets.find(row=>row.id===large.id)?.canResume).toBe(false);
  });
  it('deduplicates intent, confirmation and concurrent delivery, then exposes only ready private output',async()=>{
    const f=await fixture(),asset=await f.begin();
    const repeat=await f.service.begin(f.userId,f.tenantId,f.brandId,asset.request,f.correlationId);expect(repeat.id).toBe(asset.id);expect(repeat.upload!.expiresInSeconds).toBeLessThanOrEqual(300);
    await expect(f.service.download(f.userId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('NOT_FOUND');
    await Promise.all([f.service.confirm(f.userId,f.tenantId,f.brandId,asset.id),f.service.confirm(f.userId,f.tenantId,f.brandId,asset.id)]);
    expect(await repo.due(f.provider)).toEqual([{tenantId:f.tenantId,id:asset.id}]);
    await Promise.all([f.processor.run(f.tenantId,asset.id),f.processor.run(f.tenantId,asset.id)]);expect(f.writes()).toBe(1);expect(f.preparations()).toBe(1);
    expect((await f.row(asset.id)).status).toBe('READY');
    const replay=await f.service.begin(f.userId,f.tenantId,f.brandId,asset.request,f.correlationId);expect(replay).toMatchObject({status:'READY',upload:null});
    const overview=await f.service.overview(f.viewerId,f.tenantId,f.brandId);expect(overview.assets[0]).toMatchObject({mimeType:'audio/mpeg',durationMs:1000});
    for(const secret of ['storageKey','sourceKey','sourceSha256','inputHash'])expect(JSON.stringify(overview)).not.toContain(secret);
    expect((await f.service.download(f.viewerId,f.tenantId,f.brandId,asset.id)).expiresInSeconds).toBe(60);
    await expect(f.service.download(f.userId,f.tenantId,f.otherBrand,asset.id)).rejects.toThrow('NOT_FOUND');
    const outsider=await fixture();await expect(f.service.download(outsider.userId,outsider.tenantId,outsider.brandId,asset.id)).rejects.toThrow('NOT_FOUND');
  });
  it('binds idempotency to actor, brand and source and denies viewer mutations',async()=>{
    const f=await fixture(),asset=await f.begin();
    await expect(f.service.begin(f.editorId,f.tenantId,f.brandId,asset.request,f.correlationId)).rejects.toThrow('CONFLICT');
    await expect(f.service.begin(f.userId,f.tenantId,f.otherBrand,asset.request,f.correlationId)).rejects.toThrow('CONFLICT');
    await expect(f.service.begin(f.userId,f.tenantId,f.brandId,{...asset.request,name:'changed'},f.correlationId)).rejects.toThrow('CONFLICT');
    await expect(f.service.begin(f.userId,f.tenantId,f.brandId,{...asset.request,source:{...asset.request.source,sha256:'0'.repeat(64)}},f.correlationId)).rejects.toThrow('CONFLICT');
    await expect(f.service.begin(f.viewerId,f.tenantId,f.brandId,f.input(),f.correlationId)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(f.service.confirm(f.editorId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(f.service.delete(f.viewerId,f.tenantId,f.brandId,asset.id,f.correlationId)).rejects.toThrow('NOT_AUTHORIZED');
  });
  it('checks the downloaded snapshot size and SHA-256 before decoding',async()=>{
    const f=await fixture();
    for(const replacement of [Buffer.alloc(f.source.length),f.source.subarray(0,12)]){
      const asset=await f.queued();f.objects.set(asset.upload!.fields.key!,replacement);await f.processor.run(f.tenantId,asset.id);
      expect(await f.row(asset.id)).toMatchObject({status:'FAILED',error_code:'INVALID_MEDIA'});
    }
    expect(f.preparations()).toBe(0);expect(f.writes()).toBe(0);
  });
  it('rechecks current writer permissions after preparation',async()=>{
    const f=await fixture(),asset=await f.queued();
    f.onPrepare(async()=>{await database.client`update organization_members set role='VIEWER' where tenant_id=${f.tenantId} and user_id=${f.userId}`;});
    await f.processor.run(f.tenantId,asset.id);expect(f.writes()).toBe(0);expect(await f.row(asset.id)).toMatchObject({status:'FAILED',error_code:'NOT_AUTHORIZED'});
  });
  it('does not overwrite a newer attempt or permit stale completion after lease expiry',async()=>{
    const f=await fixture(),asset=await f.queued(),first=await repo.claim(f.tenantId,asset.id,f.provider);expect(first).not.toBeNull();
    await database.client`update library_media set lease_expires_at=now()-interval '1 second' where id=${asset.id}`;
    const second=await repo.claim(f.tenantId,asset.id,f.provider);expect(second!.attempt).toBe(2);expect(libraryOutputKey(first!)).not.toBe(libraryOutputKey(second!));
    await expect(repo.prepare(first!)).rejects.toThrow('CONFLICT');
    const output={mimeType:'audio/mpeg' as const,bytes:32,durationMs:1000,width:null,height:null,hasAudio:true};
    f.objects.set(libraryOutputKey(second!),Buffer.alloc(32,2));await repo.complete(second!,output);
    f.objects.set(libraryOutputKey(first!),Buffer.alloc(32,1));await expect(repo.complete(first!,output)).rejects.toThrow('CONFLICT');
    await f.cleanupNow(asset.id);expect(f.objects.has(libraryOutputKey(first!))).toBe(false);expect(f.objects.get(libraryOutputKey(second!))).toEqual(Buffer.alloc(32,2));expect(f.objects.has(asset.upload!.fields.key!)).toBe(false);
  });
  it('fences deletion during a storage write, retries cleanup and sweeps late writes',async()=>{
    const f=await fixture(),asset=await f.queued();f.onPut(async()=>{await f.service.delete(f.userId,f.tenantId,f.brandId,asset.id,f.correlationId);});
    await f.processor.run(f.tenantId,asset.id);const pending=await f.row(asset.id);expect(pending.status).toBe('DELETE_PENDING');expect(new Date(pending.cleanup_after).getTime()).toBeGreaterThan(Date.now()+250_000);
    await expect(f.service.download(f.userId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('NOT_FOUND');
    f.failDelete(true);await f.cleanupNow(asset.id);expect((await f.row(asset.id)).status).toBe('DELETE_PENDING');f.failDelete(false);
    await f.cleanupNow(asset.id);expect(await f.row(asset.id)).toMatchObject({status:'DELETED',name:'[deleted]',source_sha256:'0'.repeat(64),storage_key:null});expect(f.objects.size).toBe(0);
    f.objects.set(asset.upload!.fields.key!,f.source);await f.cleanupNow(asset.id);expect(f.objects.size).toBe(0);
    await expect(f.service.begin(f.userId,f.tenantId,f.brandId,asset.request,f.correlationId)).rejects.toThrow('CONFLICT');
  });
  it('bounds retries and recovers lost dispatch without duplicate processing',async()=>{
    const f=await fixture(),asset=await f.queued();await repo.dispatched(f.tenantId,asset.id);expect(await repo.due(f.provider)).toHaveLength(0);
    await database.client`update library_media set dispatch_after=now() where id=${asset.id}`;expect(await repo.due(f.provider)).toHaveLength(1);
    f.failGet(true);
    for(let attempt=1;attempt<=3;attempt++){
      await f.processor.run(f.tenantId,asset.id);const row=await f.row(asset.id);expect(row.attempt).toBe(attempt);expect(row.status).toBe(attempt===3?'FAILED':'QUEUED');
      if(attempt<3){expect(new Date(row.next_attempt_at).getTime()).toBeGreaterThan(Date.now());await database.client`update library_media set next_attempt_at=now(),dispatch_after=now() where id=${asset.id}`;}
    }
    expect(await repo.claim(f.tenantId,asset.id,f.provider)).toBeNull();expect(f.writes()).toBe(0);
  });
  it('uses database time for dispatch and active leases despite fast and slow worker clocks',async()=>{
    const f=await fixture(),asset=await f.begin(),realNow=Date.now();
    const output={mimeType:'audio/mpeg' as const,bytes:32,durationMs:1000,width:null,height:null,hasAudio:true};
    try{
      vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(realNow-86_400_000);
      await f.service.confirm(f.userId,f.tenantId,f.brandId,asset.id);
      const [queued]=await database.client`select abs(extract(epoch from (next_attempt_at-clock_timestamp())))::float8 as age from library_media where id=${asset.id}`;
      expect(queued!.age).toBeLessThan(5);expect(await repo.due(f.provider)).toHaveLength(1);
      vi.setSystemTime(realNow+86_400_000);await repo.dispatched(f.tenantId,asset.id);
      const [dispatch]=await database.client`select extract(epoch from (dispatch_after-clock_timestamp()))::float8 as remaining from library_media where id=${asset.id}`;
      expect(dispatch!.remaining).toBeGreaterThan(5);expect(dispatch!.remaining).toBeLessThanOrEqual(10);expect(await repo.due(f.provider)).toHaveLength(0);
      vi.setSystemTime(realNow-86_400_000);const job=await repo.claim(f.tenantId,asset.id,f.provider);expect(job).not.toBeNull();
      const [leased]=await database.client`select extract(epoch from (lease_expires_at-clock_timestamp()))::float8 as remaining from library_media where id=${asset.id}`;
      expect(leased!.remaining).toBeGreaterThan(290);expect(leased!.remaining).toBeLessThanOrEqual(300);
      vi.setSystemTime(realNow+86_400_000);expect(await repo.claim(f.tenantId,asset.id,f.provider)).toBeNull();
      await repo.prepare(job!);await repo.complete(job!,output);
      const [ready]=await database.client`select status,abs(extract(epoch from (finished_at-clock_timestamp())))::float8 as age from library_media where id=${asset.id}`;
      expect(ready!.status).toBe('READY');expect(ready!.age).toBeLessThan(5);
    }finally{vi.useRealTimers();}
  });
  it('keeps retry backoff and expired-token rejection independent of worker clocks',async()=>{
    const f=await fixture(),asset=await f.queued(),realNow=Date.now();
    const output={mimeType:'audio/mpeg' as const,bytes:32,durationMs:1000,width:null,height:null,hasAudio:true};
    try{
      vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(realNow-86_400_000);
      const first=await repo.claim(f.tenantId,asset.id,f.provider);await repo.fail(first!,'PROVIDER_UNAVAILABLE');
      const [retry]=await database.client`select extract(epoch from (next_attempt_at-clock_timestamp()))::float8 as remaining from library_media where id=${asset.id}`;
      expect(retry!.remaining).toBeGreaterThan(5);expect(retry!.remaining).toBeLessThanOrEqual(10);
      vi.setSystemTime(realNow+86_400_000);expect(await repo.claim(f.tenantId,asset.id,f.provider)).toBeNull();expect(await repo.due(f.provider)).toHaveLength(0);
      await database.client`update library_media set next_attempt_at=clock_timestamp(),dispatch_after=clock_timestamp() where id=${asset.id}`;
      vi.setSystemTime(realNow-86_400_000);const second=await repo.claim(f.tenantId,asset.id,f.provider);expect(second!.attempt).toBe(2);
      await database.client`update library_media set lease_expires_at=clock_timestamp()-interval '1 second' where id=${asset.id}`;
      await expect(repo.prepare(second!)).rejects.toThrow('CONFLICT');await expect(repo.complete(second!,output)).rejects.toThrow('CONFLICT');await expect(repo.fail(second!,'PROVIDER_UNAVAILABLE')).rejects.toThrow('CONFLICT');
      const third=await repo.claim(f.tenantId,asset.id,f.provider);expect(third!.attempt).toBe(3);expect(third!.leaseToken).not.toBe(second!.leaseToken);
      await expect(repo.complete(second!,output)).rejects.toThrow('CONFLICT');await repo.fail(third!,'PROVIDER_UNAVAILABLE');
      expect(await f.row(asset.id)).toMatchObject({status:'FAILED',attempt:3});expect(await repo.claim(f.tenantId,asset.id,f.provider)).toBeNull();
      const [failed]=await database.client`select abs(extract(epoch from (finished_at-clock_timestamp())))::float8 as age from library_media where id=${asset.id}`;expect(failed!.age).toBeLessThan(5);
    }finally{vi.useRealTimers();}
  });
  it('preserves cleanup fences and late-write sweeps despite worker clock jumps',async()=>{
    const f=await fixture(),asset=await f.queued(),job=await repo.claim(f.tenantId,asset.id,f.provider),realNow=Date.now();expect(job).not.toBeNull();
    try{
      vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(realNow+2*86_400_000);
      await f.service.delete(f.userId,f.tenantId,f.brandId,asset.id,f.correlationId);
      const [scheduled]=await database.client`select extract(epoch from (cleanup_after-clock_timestamp()))::float8 as delay,extract(epoch from (cleanup_until-clock_timestamp()))::float8 as sweep from library_media where id=${asset.id}`;
      expect(scheduled!.delay).toBeGreaterThan(350);expect(scheduled!.delay).toBeLessThanOrEqual(360);expect(scheduled!.sweep).toBeGreaterThan(86_390);expect(scheduled!.sweep).toBeLessThanOrEqual(86_400);
      expect(await repo.claimCleanup(f.provider)).toBeNull();
      await database.client`update library_media set cleanup_after=clock_timestamp() where id=${asset.id}`;
      vi.setSystemTime(realNow-2*86_400_000);const first=await repo.claimCleanup(f.provider);expect(first).not.toBeNull();
      const [leased]=await database.client`select extract(epoch from (cleanup_expires_at-clock_timestamp()))::float8 as remaining from library_media where id=${asset.id}`;expect(leased!.remaining).toBeGreaterThan(110);expect(leased!.remaining).toBeLessThanOrEqual(120);
      vi.setSystemTime(realNow+2*86_400_000);expect(await repo.claimCleanup(f.provider)).toBeNull();
      await database.client`update library_media set cleanup_expires_at=clock_timestamp()-interval '1 second' where id=${asset.id}`;
      vi.setSystemTime(realNow-2*86_400_000);await expect(repo.finishCleanup(first!,true)).rejects.toThrow('CONFLICT');
      const second=await repo.claimCleanup(f.provider);expect(second!.cleanupToken).not.toBe(first!.cleanupToken);await expect(repo.finishCleanup(first!,true)).rejects.toThrow('CONFLICT');
      vi.setSystemTime(realNow+2*86_400_000);await repo.finishCleanup(second!,true);
      const [deleted]=await database.client`select status,extract(epoch from (cleanup_after-clock_timestamp()))::float8 as delay,abs(extract(epoch from (deleted_at-clock_timestamp())))::float8 as age from library_media where id=${asset.id}`;
      expect(deleted!.status).toBe('DELETED');expect(deleted!.delay).toBeGreaterThan(3590);expect(deleted!.delay).toBeLessThanOrEqual(3600);expect(deleted!.age).toBeLessThan(5);
      const deletedAt=(await f.row(asset.id)).deleted_at;
      await database.client`update library_media set cleanup_until=clock_timestamp()-interval '1 second',cleanup_after=clock_timestamp() where id=${asset.id}`;
      vi.setSystemTime(realNow-2*86_400_000);const last=await repo.claimCleanup(f.provider);await repo.finishCleanup(last!,true);
      expect(await f.row(asset.id)).toMatchObject({cleanup_after:null,deleted_at:deletedAt});
      expect(await database.client`select id from audit_logs where resource_id=${asset.id} and action='LIBRARY_MEDIA_DELETED'`).toHaveLength(1);
    }finally{vi.useRealTimers();}
  });
  it('uses bounded database-clock cleanup retry delays',async()=>{
    const f=await fixture(),asset=await f.begin(),realNow=Date.now();await f.service.delete(f.userId,f.tenantId,f.brandId,asset.id,f.correlationId);
    await database.client`update library_media set cleanup_after=clock_timestamp() where id=${asset.id}`;
    try{
      vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(realNow-86_400_000);
      const first=await repo.claimCleanup(f.provider);await repo.finishCleanup(first!,false);
      const [retry]=await database.client`select extract(epoch from (cleanup_after-clock_timestamp()))::float8 as remaining from library_media where id=${asset.id}`;expect(retry!.remaining).toBeGreaterThan(5);expect(retry!.remaining).toBeLessThanOrEqual(10);
      vi.setSystemTime(realNow+86_400_000);expect(await repo.claimCleanup(f.provider)).toBeNull();
      await database.client`update library_media set cleanup_after=clock_timestamp(),cleanup_attempts=20 where id=${asset.id}`;
      const next=await repo.claimCleanup(f.provider);await repo.finishCleanup(next!,false);
      const [capped]=await database.client`select extract(epoch from (cleanup_after-clock_timestamp()))::float8 as remaining from library_media where id=${asset.id}`;expect(capped!.remaining).toBeGreaterThan(3590);expect(capped!.remaining).toBeLessThanOrEqual(3600);
    }finally{vi.useRealTimers();}
  });
  it('rechecks lease expiry after waiting for the tenant lock',async()=>{
    const f=await fixture(),asset=await f.queued(),job=await repo.claim(f.tenantId,asset.id,f.provider);
    let unlock!:()=>void,entered!:()=>void,blockerPid=0;
    const locked=new Promise<void>(resolve=>{entered=resolve;});
    const release=new Promise<void>(resolve=>{unlock=resolve;});
    const blocker=database.client.begin(async connection=>{
      await connection`select id from organizations where id=${f.tenantId} for update`;
      const [backend]=await connection`select pg_backend_pid() as pid`;blockerPid=backend!.pid;entered();await release;
      await connection`update library_media set lease_expires_at=clock_timestamp() where id=${asset.id}`;
    });
    await locked;
    const completion=repo.prepare(job!).then(()=>null,error=>error as Error);
    try{await expect.poll(async()=>{const [row]=await database.client`select exists(select 1 from pg_stat_activity where ${blockerPid}=any(pg_blocking_pids(pid))) as waiting`;return row!.waiting;}).toBe(true);}
    finally{unlock();await blocker;}
    expect(await completion).toMatchObject({message:'CONFLICT'});
  });
  it('fails configuration explicitly but permits deletion when uploads are disabled',async()=>{
    const f=await fixture(),asset=await f.queued(),disabled=new LibraryMediaService(repo,f.storage,false,f.provider);
    await expect(disabled.begin(f.userId,f.tenantId,f.brandId,f.input(),f.correlationId)).rejects.toThrow('CONFIGURATION_REQUIRED');
    await new LibraryMediaProcessor(repo,f.storage,null,true,f.provider).run(f.tenantId,asset.id);expect(await f.row(asset.id)).toMatchObject({status:'FAILED',error_code:'CONFIGURATION_REQUIRED'});expect(f.preparations()).toBe(0);
    await disabled.delete(f.userId,f.tenantId,f.brandId,asset.id,f.correlationId);expect((await f.row(asset.id)).status).toBe('DELETE_PENDING');
  });
  it('expires upload grants without extending them and cleans abandoned sources',async()=>{
    const f=await fixture(),asset=await f.begin();await database.client`update library_media set upload_expires_at=now()-interval '11 minutes' where id=${asset.id}`;
    await expect(f.service.begin(f.userId,f.tenantId,f.brandId,asset.request,f.correlationId)).rejects.toThrow('CONFLICT');
    await expect(f.service.confirm(f.userId,f.tenantId,f.brandId,asset.id)).rejects.toThrow('CONFLICT');
    expect(await f.processor.cleanupOne()).toBe(true);expect((await f.row(asset.id)).status).toBe('DELETED');expect(f.objects.size).toBe(0);
  });
  it('does not return a grant that signing latency could extend past the saved deadline',async()=>{
    const f=await fixture(),now=Date.now;
    const storage:StorageProvider&DirectUploadProvider={...f.storage,signedUpload:async input=>{
      const result=await f.storage.signedUpload(input,{tenantId:f.tenantId,internalId:randomUUID(),idempotencyKey:randomUUID(),correlationId:f.correlationId,signal:new AbortController().signal});
      const delayed=now()+10_000;vi.spyOn(Date,'now').mockReturnValue(delayed);return result;
    }};
    try{await expect(new LibraryMediaService(repo,storage,true,f.provider).begin(f.userId,f.tenantId,f.brandId,f.input(),f.correlationId)).rejects.toThrow('PROVIDER_UNAVAILABLE');}
    finally{vi.restoreAllMocks();}
  });
  it('serializes concurrent storage quota reservations including all output attempts',async()=>{
    const f=await fixture();
    const requests=await Promise.allSettled(Array.from({length:6},()=>f.service.begin(f.userId,f.tenantId,f.brandId,{...f.input(),source:{mimeType:'video/mp4',bytes:64*1024*1024,sha256:'a'.repeat(64)}},f.correlationId)));
    expect(requests.filter(row=>row.status==='fulfilled')).toHaveLength(4);
    for(const result of requests)if(result.status==='rejected')expect(result.reason).toMatchObject({code:'PLAN_LIMIT_REACHED'});
  });
  it('rejects malformed output and database cross-tenant or incomplete READY rows',async()=>{
    const f=await fixture(),asset=await f.queued();
    const wrong:MediaPreparationProvider={prepare:async()=>({bytes:Buffer.alloc(32),mimeType:'audio/mpeg',durationMs:1000,width:100,height:100,hasAudio:true})};
    await new LibraryMediaProcessor(repo,f.storage,wrong,true,f.provider).run(f.tenantId,asset.id);expect((await f.row(asset.id)).error_code).toBe('INVALID_MEDIA');expect(f.writes()).toBe(0);
    await expect(database.client`update library_media set status='READY' where id=${asset.id}`).rejects.toThrow();
    const other=await fixture();await expect(database.client`update library_media set brand_id=${other.brandId} where id=${asset.id}`).rejects.toThrow();
  });
});
