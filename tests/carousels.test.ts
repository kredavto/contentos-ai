import { expect, it } from 'vitest';
import { carouselSchema, carouselPublicationText } from '../packages/types/src/index';
it('validates bounded slides/design and exports only the public caption',()=>{
 const value={title:'Internal',slides:[{heading:'One',body:'Text'},{heading:'Two',body:'Text'}],caption:'Public',hashtags:['учёба'],factCheckNotes:['Internal note'],design:{format:'SQUARE',font:'SANS',backgroundColor:'#ffffff',textColor:'#000000',accentColor:'#112233'}};
 const parsed=carouselSchema.parse(value);expect(carouselPublicationText(parsed)).toBe('Public\n\n#учёба');
 for(const patch of [{slides:[]},{slides:Array(11).fill(value.slides[0])},{slides:[{heading:'x'.repeat(101),body:'Text'},value.slides[1]]},{caption:' '},{design:{...value.design,backgroundColor:'url(https://example.com)'}},{extra:true}])expect(carouselSchema.safeParse({...value,...patch}).success).toBe(false);
});
