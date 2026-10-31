import {createHash} from 'node:crypto';
import {z} from 'zod';
import {DomainError,youtubeCommentCursorSchema,commentImportPositionSchema,type CommentImportPosition} from '@contentos/types';
const cursor=youtubeCommentCursorSchema.nullable();
const threadResult=z.object({nextCursor:cursor,parentIds:z.array(z.uuid()).max(20)}).strict().refine(value=>new Set(value.parentIds).size===value.parentIds.length);
const replyResult=z.object({nextCursor:cursor}).strict();
function providerResult<T>(schema:z.ZodType<T>,raw:unknown):T{const result=schema.safeParse(raw);if(!result.success)throw new DomainError('PROVIDER_REJECTED',502);return result.data;}
/** Transactional import code supplies persisted root IDs; never browser-supplied IDs. */
export function advanceCommentThreads(rawPosition:unknown,rawPage:unknown):CommentImportPosition|null{
 const position=providerResult(commentImportPositionSchema,rawPosition),page=providerResult(threadResult,rawPage);
 if(position.kind!=='THREADS'||(page.nextCursor!==null&&page.nextCursor===position.cursor))throw new DomainError('PROVIDER_REJECTED',502);
 const [parentId,...pendingParentIds]=page.parentIds;
 if(parentId)return {kind:'REPLIES',cursor:null,parentId,pendingParentIds,nextThreadCursor:page.nextCursor};
 return page.nextCursor===null?null:{kind:'THREADS',cursor:page.nextCursor};
}
export function advanceCommentReplies(rawPosition:unknown,rawPage:unknown):CommentImportPosition|null{
 const position=providerResult(commentImportPositionSchema,rawPosition),page=providerResult(replyResult,rawPage);
 if(position.kind!=='REPLIES'||(page.nextCursor!==null&&page.nextCursor===position.cursor))throw new DomainError('PROVIDER_REJECTED',502);
 if(page.nextCursor!==null)return {...position,cursor:page.nextCursor};
 const [parentId,...pendingParentIds]=position.pendingParentIds;
 if(parentId)return {...position,parentId,pendingParentIds,cursor:null};
 return position.nextThreadCursor===null?null:{kind:'THREADS',cursor:position.nextThreadCursor};
}
/** Scope is part of cursor identity: two parents may legitimately use the same token. */
export function commentPageIdentity(rawPosition:unknown){
 const position=providerResult(commentImportPositionSchema,rawPosition);
 return {scope:position.kind==='THREADS'?'THREADS':position.parentId,cursorHash:createHash('sha256').update(JSON.stringify(position.cursor)).digest('hex')};
}
/** Store the exact next position even when the per-run page budget is exhausted. */
export function commentImportCheckpoint(next:CommentImportPosition|null,remainingPages:number){
 const remaining=z.number().int().min(1).max(200).parse(remainingPages)-1;
 const position=next===null?null:commentImportPositionSchema.parse(next);
 return {position,remainingPages:remaining,status:position===null?'SUCCEEDED' as const:remaining===0?'PARTIAL' as const:'QUEUED' as const};
}
