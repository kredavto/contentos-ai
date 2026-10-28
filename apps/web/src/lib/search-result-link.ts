import type {SearchPage} from '@contentos/types';
/** Only scripts have a dedicated exact-object destination; other kinds remain sections. */
export function searchResultLink(item:SearchPage['items'][number],tenantId:string){
  const scope=new URLSearchParams({organization:tenantId}).toString();
  const brand=encodeURIComponent(item.brandId);
  if(item.kind==='SCRIPT')return {href:`/brands/${brand}/scripts/${encodeURIComponent(item.id)}?${scope}`,label:'Открыть сценарий'};
  if(item.kind==='BRAND')return {href:`/brands/${brand}/onboarding?${scope}`,label:'Открыть раздел бренда'};
  const tab=item.kind==='IDEA'?'ideas':item.kind==='PUBLICATION'?'publishing':'calendar';
  return {href:`/brands/${brand}/content?${scope}&tab=${tab}`,label:'Открыть раздел бренда'};
}
