import {sql} from 'drizzle-orm';
import {searchItemSchema,type SearchQuery} from '@contentos/types';
import type {Database} from '../index';
import {assertMembership} from './ledger';

/** Current tenant content only; no credentials, job snapshots or historical versions. */
export class SearchRepository {
  constructor(private readonly db:Database){}
  async search(userId:string,tenantId:string,input:SearchQuery){
    return this.db.transaction(async tx=>{
      await assertMembership(tx,userId,tenantId);
      await tx.execute(sql`set local statement_timeout='3000ms'`);
      const pattern=`%${input.q.replace(/[\\%_]/g,'\\$&')}%`;
      const rows=await tx.execute(sql`
        with candidates as (
          select b.id,'BRAND'::text as kind,b.id as brand_id,b.name as brand_name,b.name as title,b.name as body
          from brands b where b.tenant_id=${tenantId}::uuid
          union all
          select i.id,'IDEA',b.id,b.name,i.title,concat_ws(' ',i.title,i.angle,i.hook)
          from ideas i join brands b on b.tenant_id=i.tenant_id and b.id=i.brand_id where i.tenant_id=${tenantId}::uuid
          union all
          select s.id,'SCRIPT',b.id,b.name,c.title,concat_ws(' ',c.title,v.content->>'hook',v.content->>'context',v.content->>'core',v.content->>'proof',v.content->>'cta')
          from scripts s join brands b on b.tenant_id=s.tenant_id and b.id=s.brand_id
          join content_items c on c.tenant_id=s.tenant_id and c.brand_id=s.brand_id and c.id=s.content_item_id
          join script_versions v on v.tenant_id=s.tenant_id and v.script_id=s.id and v.version=s.current_version where s.tenant_id=${tenantId}::uuid
          union all
          select c.id,'CONTENT',b.id,b.name,c.title,concat_ws(' ',c.title,pv.content->>'body',cv.content->>'caption',
            (select string_agg(concat_ws(' ',slide->>'heading',slide->>'body'),' ') from jsonb_array_elements(coalesce(cv.content->'slides','[]'::jsonb)) slide))
          from content_items c join brands b on b.tenant_id=c.tenant_id and b.id=c.brand_id
          left join posts post on post.tenant_id=c.tenant_id and post.brand_id=c.brand_id and post.content_item_id=c.id
          left join content_versions pv on pv.tenant_id=post.tenant_id and pv.post_id=post.id and pv.version=post.current_version
          left join carousels carousel on carousel.tenant_id=c.tenant_id and carousel.brand_id=c.brand_id and carousel.content_item_id=c.id
          left join carousel_versions cv on cv.tenant_id=carousel.tenant_id and cv.carousel_id=carousel.id and cv.version=carousel.current_version
          where c.tenant_id=${tenantId}::uuid
          union all
          select p.id,'PUBLICATION',b.id,b.name,c.title,concat_ws(' ',c.title,j.snapshot->>'caption',p.provider)
          from publications p join publishing_jobs j on j.tenant_id=p.tenant_id and j.id=p.job_id
          join brands b on b.tenant_id=j.tenant_id and b.id=j.brand_id
          join content_items c on c.tenant_id=j.tenant_id and c.brand_id=j.brand_id and c.id=j.content_item_id where p.tenant_id=${tenantId}::uuid
        )
        select id,kind,brand_id as "brandId",brand_name as "brandName",left(title,200) as title,
          substring(body from greatest(1,strpos(lower(body),lower(${input.q}))-60) for 240) as excerpt
        from candidates where body ilike ${pattern} escape '\\'
          ${input.kind?sql`and kind=${input.kind}`:sql``}
          ${input.afterKind&&input.afterId?sql`and (kind,id)>(${input.afterKind},${input.afterId}::uuid)`:sql``}
        order by kind,id limit 31`);
      const items=rows.slice(0,30).map(row=>searchItemSchema.parse(row));
      const last=items.at(-1);
      return {items,next:rows.length>30&&last?{afterKind:last.kind,afterId:last.id}:null};
    });
  }
}
