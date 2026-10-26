import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {CommentDeliveryService} from '../packages/core/src/comment-deliveries';
const ids=()=>[randomUUID(),randomUUID(),randomUUID(),randomUUID(),randomUUID()] as const;
it('requires explicit confirmation and configured write capability before enqueue',async()=>{
 const repository={latest:vi.fn(),request:vi.fn()},scope=ids(),input={approvalId:randomUUID(),idempotencyKey:randomUUID(),confirmSend:true};
 const disabled=new CommentDeliveryService(repository,false),enabled=new CommentDeliveryService(repository,true);
 expect(()=>disabled.request(...scope,input,randomUUID())).toThrow('CONFIGURATION_REQUIRED');
 for(const raw of [{...input,confirmSend:false},{...input,confirmSend:undefined},{...input,extra:true},{...input,approvalId:'not-an-id'}])expect(()=>enabled.request(...scope,raw,randomUUID())).toThrow();
 expect(repository.request).not.toHaveBeenCalled();
 enabled.request(...scope,input,scope[0]);
 expect(repository.request).toHaveBeenCalledWith(scope[0],scope[1],scope[2],input.approvalId,input.idempotencyKey,scope[0],{publicationId:scope[3],commentId:scope[4]});
});
it('returns unavailable configuration separately from the authorized delivery status',async()=>{
 const repository={latest:vi.fn().mockResolvedValue(null),request:vi.fn()},scope=ids();
 expect(await new CommentDeliveryService(repository,false).latest(...scope)).toEqual({job:null,configuration:{ready:false}});
 expect(repository.latest).toHaveBeenCalledWith(...scope);
 await expect(new CommentDeliveryService(repository,true).latest('invalid',...scope.slice(1) as [string,string,string,string])).rejects.toThrow();
});
