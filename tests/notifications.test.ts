import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {notificationBatchReadSchema,notificationListSchema} from '../packages/types/src/notifications';
it('accepts only one to fifty distinct notification IDs',()=>{
  for(const count of [1,50]){const ids=Array.from({length:count},()=>randomUUID());expect(notificationBatchReadSchema.parse({ids})).toEqual({ids});}
  const id=randomUUID();for(const ids of [[],[id,id],['invalid'],Array.from({length:51},()=>randomUUID())])expect(notificationBatchReadSchema.safeParse({ids}).success).toBe(false);
});
it('rejects unknown fields and implicit mark-all requests',()=>{
  for(const raw of [{},{all:true},{ids:randomUUID()},{ids:[randomUUID()],tenantId:randomUUID()}])expect(notificationBatchReadSchema.safeParse(raw).success).toBe(false);
});

it('defaults to all notifications and validates explicit unread filters and cursors',()=>{
  expect(notificationListSchema.parse({})).toEqual({status:'ALL'});
  const cursor=randomUUID();expect(notificationListSchema.parse({status:'UNREAD',cursor})).toEqual({status:'UNREAD',cursor});
  for(const raw of [{status:'READ'},{status:'unread'},{status:true},{cursor:'bad'},{unread:true}])expect(notificationListSchema.safeParse(raw).success).toBe(false);
});
