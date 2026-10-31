import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {importedThreadPageSchema,importedReplyPageSchema} from '../packages/types/src/comment-pages';
const comment={externalId:'comment-1',parentExternalId:null,authorExternalId:null,authorName:null,text:'<script>untrusted text</script>\nA question',publishedAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-02T00:00:00.000Z'};
const thread={externalId:'thread-1',comment,replyCount:2,canReply:true,isPublic:true};
function page(){return {reference:{provider:'youtube',internalId:randomUUID(),externalId:'abcdefghijk',metadata:{kind:'comment-threads',channelId:'UC'+'a'.repeat(22)}},observedAt:'2026-01-03T00:00:00.000Z',nextCursor:null,items:[thread]};}
function replies(){const p=page();return {...p,reference:{...p.reference,externalId:comment.externalId,metadata:{...p.reference.metadata,kind:'comment-replies'}},items:[{...comment,externalId:'reply-1',parentExternalId:comment.externalId}]};}
describe('normalized import page boundary',()=>{
 it('preserves untrusted text and missing author data without inventing content',()=>{
  const result=importedThreadPageSchema.parse(page());expect(result.items[0]?.comment).toEqual(comment);
  expect(importedThreadPageSchema.parse({...page(),items:[]})).toMatchObject({items:[],nextCursor:null});
  expect(importedThreadPageSchema.safeParse({...page(),items:[{...thread,comment:{...comment,text:'',authorName:''}}]}).success).toBe(true);
 });
 it('rejects duplicate external identities and nested roots before persistence',()=>{
  expect(importedThreadPageSchema.safeParse({...page(),items:[thread,thread]}).success).toBe(false);
  expect(importedThreadPageSchema.safeParse({...page(),items:[thread,{...thread,externalId:'thread-2'}]}).success).toBe(false);
  expect(importedThreadPageSchema.safeParse({...page(),items:[{...thread,comment:{...comment,parentExternalId:'other'}}]}).success).toBe(false);
 });
 it('binds every reply to the referenced parent and rejects duplicate or self replies',()=>{
  const p=replies();expect(importedReplyPageSchema.parse(p).items).toHaveLength(1);
  expect(importedReplyPageSchema.safeParse({...p,items:[{...p.items[0],parentExternalId:'other'}]}).success).toBe(false);
  expect(importedReplyPageSchema.safeParse({...p,items:[{...p.items[0],externalId:comment.externalId}]}).success).toBe(false);
  expect(importedReplyPageSchema.safeParse({...p,items:[...p.items,...p.items]}).success).toBe(false);
 });
 it('bounds pages, rejects invalid times and PostgreSQL-incompatible text',()=>{
  const p=page();expect(importedThreadPageSchema.safeParse({...p,items:Array.from({length:21},(_,i)=>({...thread,externalId:`thread-${i}`,comment:{...comment,externalId:`comment-${i}`}}))}).success).toBe(false);
  for(const changed of [{text:'x'.repeat(10001)},{authorName:'x'.repeat(1001)},{text:'unsafe\u0000text'},{authorName:'unsafe\u0000name'},{updatedAt:'2025-01-01T00:00:00.000Z'}])expect(importedThreadPageSchema.safeParse({...p,items:[{...thread,comment:{...comment,...changed}}]}).success).toBe(false);
  expect(importedThreadPageSchema.safeParse({...p,observedAt:'not-a-date'}).success).toBe(false);
 });
 it('rejects cross-operation references, unexpected fields and unsafe cursor values',()=>{
  const p=page();
  for(const changed of [{nextCursor:'contains space'},{nextCursor:'x'.repeat(4097)},{extra:'unexpected'},{reference:{...p.reference,externalId:'https://example.test/video'}},{reference:{...p.reference,internalId:'not-an-internal-uuid'}},{reference:{...p.reference,metadata:{...p.reference.metadata,kind:'comment-replies'}}}])expect(importedThreadPageSchema.safeParse({...p,...changed}).success).toBe(false);
 });
});
