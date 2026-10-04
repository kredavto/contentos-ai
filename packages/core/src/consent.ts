import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ConsentRepository } from '@contentos/db';
import { DomainError,acceptConsentSchema,subjectSchema,type ConsentType } from '@contentos/types';
const version='2026-10-04-v1';
const texts:Record<ConsentType,string>={
  OWN_LIKENESS:'Я являюсь человеком, указанным в этой записи. Разрешаю использовать загруженные мной изображения моего лица для создания и использования AI-аватара в контенте этого бренда. Понимаю, что результат является синтетическим изображением. Могу отозвать разрешение в центре согласий; после отзыва новые операции с этим лицом запрещены.',
  THIRD_PARTY_LIKENESS:'Подтверждаю, что получил явное разрешение указанного человека на использование его изображения для создания AI-аватара и контента этого бренда, и вправе предоставить такое разрешение. Храню подтверждающие документы. Обязуюсь отозвать это разрешение, если субъект отзовёт своё согласие. Без разрешения создание аватара запрещено.',
  VOICE_CLONING:'Подтверждаю наличие явного разрешения владельца указанного голоса на создание синтетического голосового профиля и озвучивание контента этого бренда. Разрешение распространяется только на этот голос и бренд. При отзыве новые операции клонирования и использования голоса прекращаются.',
  CROSS_BORDER_PROCESSING:'Разрешаю передавать изображения, голосовые материалы и текст, относящиеся к указанному субъекту, внешнему AI-провайдеру HeyGen для конкретно запрошенной операции. Понимаю, что обработка может происходить за пределами страны размещения приложения. Могу отозвать разрешение до выполнения следующих операций.',
  AUTOMATED_PUBLISHING:'Разрешаю автоматическую публикацию одобренного контента этого бренда через явно подключённые мной социальные каналы в соответствии с выбранными настройками. Это согласие само по себе не включает режим автопилота. Могу отозвать разрешение, после чего новые автоматические публикации запрещены.',
};
export function consentPolicy(type:ConsentType){const text=texts[type];return {type,version,text,textHash:createHash('sha256').update(text).digest('hex')};}
export class ConsentService {
  constructor(private readonly repository:ConsentRepository){}
  async overview(userId:string,tenantId:string,brandId:string){const result=await this.repository.list(userId,z.uuid().parse(tenantId),z.uuid().parse(brandId));return {...result,policies:(Object.keys(texts) as ConsentType[]).map(consentPolicy)};}
  createSubject(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){return this.repository.createSubject(userId,z.uuid().parse(tenantId),z.uuid().parse(brandId),subjectSchema.parse(raw),correlationId);}
  accept(userId:string,tenantId:string,brandId:string,raw:unknown,request:{ip:string;userAgent:string},correlationId:string){
    const input=acceptConsentSchema.parse(raw);const policy=consentPolicy(input.type);
    if(input.version!==policy.version||input.textHash!==policy.textHash)throw new DomainError('CONFLICT',409);
    return this.repository.accept(userId,z.uuid().parse(tenantId),z.uuid().parse(brandId),input,{ip:request.ip.slice(0,64),userAgent:request.userAgent.slice(0,512)},correlationId);
  }
  revoke(userId:string,tenantId:string,brandId:string,consentId:string,correlationId:string){return this.repository.revoke(userId,z.uuid().parse(tenantId),z.uuid().parse(brandId),z.uuid().parse(consentId),correlationId);}
}
