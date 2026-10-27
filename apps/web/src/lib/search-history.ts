import type {SearchPage} from '@contentos/types';

type Cursor = SearchPage['next'];
/** Only cursor bookmarks are retained, never earlier result pages or excerpts. */
export interface SearchHistory { readonly cursors: readonly Cursor[]; readonly index: number; readonly firstPage: number }
export const searchHistoryLimit = 50;
export function firstSearchPage(): SearchHistory { return {cursors:[null],index:0,firstPage:1}; }
export function searchPageNumber(history: SearchHistory) { return history.firstPage+history.index; }
export function searchPageCursor(history: SearchHistory): Cursor { return history.cursors[history.index]??null; }
export function previousSearchPage(history: SearchHistory): SearchHistory {
  return history.index>0?{...history,index:history.index-1}:history;
}
export function nextSearchPage(history: SearchHistory,cursor: NonNullable<Cursor>): SearchHistory {
  // The freshly fetched page owns the next cursor. Discard old forward history:
  // live inserts/edits may have changed the page boundary since a back navigation.
  const cursors=[...history.cursors.slice(0,history.index+1),{...cursor}];
  const dropped=Math.max(0,cursors.length-searchHistoryLimit);
  return {cursors:cursors.slice(dropped),index:cursors.length-dropped-1,firstPage:history.firstPage+dropped};
}
