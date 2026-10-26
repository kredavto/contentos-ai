import {z} from 'zod';
import type {FeaturePolicyRepository} from '@contentos/db';
import {DomainError,featureTargetSchema,featurePolicyChangeSchema} from '@contentos/types';
export class FeaturePolicyService{
 constructor(private readonly repository:Pick<FeaturePolicyRepository,'overview'|'inspect'|'change'>,private readonly adminEnabled:boolean){}
 overview(userId:string,tenantId:string){return this.repository.overview(z.uuid().parse(userId),z.uuid().parse(tenantId));}
 inspect(actorId:string,raw:unknown,correlationId:string){if(!this.adminEnabled)throw new DomainError('CONFIGURATION_REQUIRED',503);return this.repository.inspect(z.uuid().parse(actorId),featureTargetSchema.parse(raw),z.uuid().parse(correlationId));}
 change(actorId:string,raw:unknown,correlationId:string){if(!this.adminEnabled)throw new DomainError('CONFIGURATION_REQUIRED',503);return this.repository.change(z.uuid().parse(actorId),featurePolicyChangeSchema.parse(raw),z.uuid().parse(correlationId));}
}
