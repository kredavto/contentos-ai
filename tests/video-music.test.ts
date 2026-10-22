import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {backgroundMusicSchema,musicFadesFit} from '../packages/types/src/videos';
it('keeps legacy music unchanged and validates independently optional fades',()=>{
  const music={assetId:randomUUID(),volumePercent:15};
  expect(backgroundMusicSchema.parse(music)).toEqual(music);
  for(const field of ['fadeInMs','fadeOutMs']){
    for(const value of [100,5000])expect(backgroundMusicSchema.safeParse({...music,[field]:value}).success).toBe(true);
    for(const value of [0,-1,99,5001,100.5,NaN])expect(backgroundMusicSchema.safeParse({...music,[field]:value}).success).toBe(false);
  }
  expect(musicFadesFit({fadeInMs:300,fadeOutMs:700},1000)).toBe(true);
  expect(musicFadesFit({fadeInMs:300,fadeOutMs:701},1000)).toBe(false);
  expect(musicFadesFit({fadeOutMs:1000},1000)).toBe(true);
});
