import {test,expect} from '@playwright/test';
test('public readiness checks real local database, Redis and bucket access and recovers after a storage outage',async({request})=>{
 const status=async()=>{const response=await request.get('/api/health/ready');return response.status();};
 expect((await request.get('/api/health')).status()).toBe(200);
 expect((await request.post('/api/health/ready')).status()).toBe(405);
 const ready=await request.get('/api/health/ready');expect(ready.status()).toBe(200);expect(ready.headers()['cache-control']).toBe('no-store');expect(await ready.json()).toEqual({status:'ready',checks:{database:'ok',redis:'ok',storage:'ok'}});
 try{
  expect((await request.post('http://127.0.0.1:8027/__fixture/storage/off')).status()).toBe(200);
  await expect.poll(status,{timeout:12000,intervals:[100,250,500,1000]}).toBe(503);
  const unavailable=await request.get('/api/health/ready');expect(unavailable.headers()['cache-control']).toBe('no-store');expect(await unavailable.json()).toEqual({status:'not_ready',checks:{database:'ok',redis:'ok',storage:'unavailable'}});
  expect((await request.get('/api/health')).status()).toBe(200);
 }finally{
  expect((await request.post('http://127.0.0.1:8027/__fixture/storage/on')).status()).toBe(200);
  await expect.poll(status,{timeout:12000,intervals:[100,250,500,1000]}).toBe(200);
 }
});
