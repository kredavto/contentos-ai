import type {SearchPage} from '@contentos/types';
/** Non-brand results open exact read-only objects; brand results open that brand. */
export function searchResultLink(item:SearchPage['items'][number],tenantId:string){
  const scope=new URLSearchParams({organization:tenantId}).toString();
  const brand=encodeURIComponent(item.brandId);
  if(item.kind==='SCRIPT')return {href:`/brands/${brand}/scripts/${encodeURIComponent(item.id)}?${scope}`,label:'Открыть сценарий'};
  if(item.kind==='IDEA')return {href:`/brands/${brand}/ideas/${encodeURIComponent(item.id)}?${scope}`,label:'Открыть идею'};
  if(item.kind==='PUBLICATION')return {href:`/brands/${brand}/publications/${encodeURIComponent(item.id)}?${scope}`,label:'Открыть публикацию'};
  if(item.kind==='BRAND')return {href:`/brands/${brand}/onboarding?${scope}`,label:'Открыть раздел бренда'};
  return {href:`/brands/${brand}/content/${encodeURIComponent(item.id)}?${scope}`,label:'Открыть материал'};
}
