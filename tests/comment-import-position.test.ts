import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {advanceCommentThreads,advanceCommentReplies,commentPageIdentity,commentImportCheckpoint} from '../packages/core/src/comment-import-position';
describe('bounded comment import continuation',()=>{
 it('drains every reply page and queued parent before advancing the thread cursor',()=>{
  const first=randomUUID(),second=randomUUID();
  const start=advanceCommentThreads({kind:'THREADS',cursor:null},{nextCursor:'threads-next',parentIds:[first,second]});
  expect(start).toEqual({kind:'REPLIES',parentId:first,pendingParentIds:[second],cursor:null,nextThreadCursor:'threads-next'});
  const more=advanceCommentReplies(start,{nextCursor:'replies-next'});expect(more).toMatchObject({parentId:first,cursor:'replies-next',pendingParentIds:[second]});
  const following=advanceCommentReplies(more,{nextCursor:null});expect(following).toMatchObject({parentId:second,cursor:null,pendingParentIds:[],nextThreadCursor:'threads-next'});
  expect(advanceCommentReplies(following,{nextCursor:null})).toEqual({kind:'THREADS',cursor:'threads-next'});
 });
 it('does not finish when the last thread page still has unread replies',()=>{
  const position=advanceCommentThreads({kind:'THREADS',cursor:'last'},{nextCursor:null,parentIds:[randomUUID()]});
  expect(position?.kind).toBe('REPLIES');expect(commentImportCheckpoint(position,1).status).toBe('PARTIAL');
  expect(advanceCommentReplies(position,{nextCursor:null})).toBeNull();
  expect(commentImportCheckpoint(null,1)).toEqual({position:null,remainingPages:0,status:'SUCCEEDED'});
 });
 it('retains a resumable cursor at the page budget and finishes an empty final page',()=>{
  const next=advanceCommentThreads({kind:'THREADS',cursor:null},{nextCursor:'next',parentIds:[]});
  expect(commentImportCheckpoint(next,1)).toEqual({status:'PARTIAL',remainingPages:0,position:next});
  expect(commentImportCheckpoint(next,200)).toEqual({status:'QUEUED',remainingPages:199,position:next});
  expect(advanceCommentThreads({kind:'THREADS',cursor:'next'},{nextCursor:null,parentIds:[]})).toBeNull();
  for(const budget of [0,-1,201,1.5])expect(()=>commentImportCheckpoint(next,budget)).toThrow();
 });
 it('rejects invalid or non-progressing pages and duplicate or unbounded parent queues',()=>{
  const id=randomUUID(),root={kind:'THREADS',cursor:'same'},reply={kind:'REPLIES',parentId:id,cursor:'same',pendingParentIds:[],nextThreadCursor:null};
  expect(()=>advanceCommentThreads(root,{nextCursor:'same',parentIds:[]})).toThrow('PROVIDER_REJECTED');
  expect(()=>advanceCommentReplies(reply,{nextCursor:'same'})).toThrow('PROVIDER_REJECTED');
  expect(()=>advanceCommentThreads(reply,{nextCursor:null,parentIds:[]})).toThrow('PROVIDER_REJECTED');
  expect(()=>advanceCommentReplies(root,{nextCursor:null})).toThrow('PROVIDER_REJECTED');
  expect(()=>advanceCommentThreads(root,{nextCursor:null,parentIds:[id,id]})).toThrow('PROVIDER_REJECTED');
  expect(()=>advanceCommentThreads(root,{nextCursor:null,parentIds:Array.from({length:21},()=>randomUUID())})).toThrow('PROVIDER_REJECTED');
  expect(()=>advanceCommentReplies({...reply,pendingParentIds:[id]},{nextCursor:null})).toThrow('PROVIDER_REJECTED');
 });
 it('hashes cursor identity within a parent scope and distinguishes the first page',()=>{
  const token='opaque-provider-cursor',a={kind:'REPLIES',parentId:randomUUID(),cursor:token,pendingParentIds:[],nextThreadCursor:null};
  const first=commentPageIdentity(a),differentParent=commentPageIdentity({...a,parentId:randomUUID()});
  expect(first.cursorHash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(first)).not.toContain(token);
  expect(first.cursorHash).toBe(differentParent.cursorHash);expect(first.scope).not.toBe(differentParent.scope);
  expect(commentPageIdentity({...a,cursor:null}).cursorHash).not.toBe(first.cursorHash);
  expect(commentPageIdentity(a)).toEqual(first);
 });
});
