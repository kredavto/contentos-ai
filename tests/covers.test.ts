import {describe,it,expect} from 'vitest';
import {coverDesignSchema,videoProcessingSchema,videoRequestSchema} from '../packages/types/src/index';
import {coverComposition} from '../packages/providers/src/cover-design';
const design={framePercent:50,headline:'Заголовок обложки',background:'FRAME',font:'BOLD',layout:'BOTTOM',textColor:'#ffffff',backgroundColor:'#182338'} as const;
describe('cover design boundary',()=>{
  it('accepts old video options and rejects injected filters, fonts and invisible controls',()=>{
    expect(videoProcessingSchema.parse({}).cover).toBeUndefined();
    expect(coverDesignSchema.parse(design)).toEqual(design);
    for(const bad of [{frameSeconds:181},{frameSeconds:-1},{framePercent:100},{framePercent:.5},{headline:'x\nDialogue: injected'},{headline:'x\u202ey'},{headline:'x'.repeat(81)},{textColor:'red;movie=secret'},{font:'../../secret'},{backgroundColor:'#fff'},{url:'https://example.test'}])expect(coverDesignSchema.safeParse({...design,...bad}).success).toBe(false);
    expect(videoRequestSchema.shape.cover.safeParse(design).success).toBe(true);
  });
  it('keeps user text out of the filtergraph and neutralizes ASS control tags',()=>{
    const composition=coverComposition({...design,headline:'{\\pos(0,0)} Привет: 100% [a]; мир'},720,1280);
    expect(composition.ass).not.toContain('{\\pos(0,0)}');expect(composition.ass).toContain('｛＼pos(0,0)｝');
    expect(composition.filter).not.toContain('Привет');expect(composition.ass.match(/Dialogue:/g)).toHaveLength(1);
  });
});
