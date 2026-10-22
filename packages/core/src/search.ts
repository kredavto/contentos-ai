import {z} from 'zod';
import {SearchRepository} from '@contentos/db';
import {searchQuerySchema} from '@contentos/types';
export class SearchService {
  constructor(private readonly repository:SearchRepository){}
  search(userId:string,tenantId:string,raw:unknown){return this.repository.search(userId,z.uuid().parse(tenantId),searchQuerySchema.parse(raw));}
}
