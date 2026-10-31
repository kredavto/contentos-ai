import {describe,expect,it} from 'vitest';
import {firstSearchPage,nextSearchPage,previousSearchPage,searchHistoryLimit,searchPageCursor,searchPageNumber} from '../apps/web/src/lib/search-history';
const cursor=(n:number)=>({afterKind:'BRAND' as const,afterId:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`});
describe('bounded search cursor navigation',()=>{
  it('starts at the first page without a cursor and cannot step before it',()=>{
    const first=firstSearchPage();expect(searchPageCursor(first)).toBeNull();expect(searchPageNumber(first)).toBe(1);expect(previousSearchPage(first)).toBe(first);
  });
  it('returns to the exact requested page and replaces forward bookmarks from fresh results',()=>{
    const first=firstSearchPage(),second=nextSearchPage(first,cursor(1)),third=nextSearchPage(second,cursor(2));
    const back=previousSearchPage(third);expect(searchPageNumber(back)).toBe(2);expect(searchPageCursor(back)).toEqual(cursor(1));
    const forward=nextSearchPage(back,cursor(3));expect(searchPageNumber(forward)).toBe(3);expect(searchPageCursor(forward)).toEqual(cursor(3));expect(forward.cursors).not.toContainEqual(cursor(2));
    expect(searchPageCursor(previousSearchPage(back))).toBeNull();
  });
  it('bounds memory without preventing further next navigation or misnumbering retained pages',()=>{
    let history=firstSearchPage();for(let n=1;n<=123;n++)history=nextSearchPage(history,cursor(n));
    expect(history.cursors).toHaveLength(searchHistoryLimit);expect(searchPageNumber(history)).toBe(124);
    for(let n=0;n<searchHistoryLimit-1;n++)history=previousSearchPage(history);
    expect(history.index).toBe(0);expect(searchPageNumber(history)).toBe(75);expect(searchPageCursor(history)).toEqual(cursor(74));
    expect(previousSearchPage(history)).toBe(history);expect(searchPageNumber(firstSearchPage())).toBe(1);
  });
  it('does not mutate committed history while a prospective navigation can still fail',()=>{
    const history=nextSearchPage(firstSearchPage(),cursor(1));const snapshot=JSON.stringify(history);
    nextSearchPage(history,cursor(2));previousSearchPage(history);
    expect(JSON.stringify(history)).toBe(snapshot);expect(searchPageNumber(history)).toBe(2);
  });
  it('copies response cursors and resets independently for new submissions',()=>{
    const boundary=cursor(1),history=nextSearchPage(firstSearchPage(),boundary);boundary.afterId=cursor(9).afterId;
    expect(searchPageCursor(history)).toEqual(cursor(1));expect(firstSearchPage()).toEqual({cursors:[null],index:0,firstPage:1});
    expect(Object.keys(history).sort()).toEqual(['cursors','firstPage','index']);
  });
});
