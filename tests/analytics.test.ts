import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {manualMetricsSchema,normalizedMetricsSchema} from '../packages/types/src/analytics';
describe('normalized publication observations',()=>{
  const input=()=>({publicationId:randomUUID(),idempotencyKey:randomUUID(),observedAt:'2026-10-04T10:00:00Z',sourceNote:'Platform statistics',metrics:{views:0}});
  it('preserves observed zero and missing values separately',()=>{const result=manualMetricsSchema.parse(input());expect(result.metrics.views).toBe(0);expect(result.metrics.likes).toBeNull();expect(Object.keys(result.metrics)).toHaveLength(12);});
  it('rejects empty, coercible, unknown and invalid metrics',()=>{for(const metrics of [{},{views:null},{views:'0'},{views:-1},{likes:1.1},{views:Infinity},{completion_rate:1.1},{unknown:1},{reach:1e13}])expect(manualMetricsSchema.safeParse({...input(),metrics}).success).toBe(false);});
  it('keeps seconds, signed attributable follower changes and fractional completion explicit',()=>{expect(normalizedMetricsSchema.parse({watch_time:1.25,completion_rate:0,followers_delta:-2})).toMatchObject({watch_time:1.25,completion_rate:0,followers_delta:-2});expect(manualMetricsSchema.safeParse({...input(),source:'API'}).success).toBe(false);expect(manualMetricsSchema.safeParse({...input(),sourceNote:'📊!'}).success).toBe(false);});
});
