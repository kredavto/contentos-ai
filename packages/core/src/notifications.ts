import { z } from 'zod';
import { NotificationRepository } from '@contentos/db';
import { notificationReadSchema, type NotificationType } from '@contentos/types';
const copy:Record<NotificationType,{title:string;body:string;tab?:string}>={
  VIDEO_READY:{title:'Видео готово',body:'Готовый ролик доступен в видеостудии.',tab:'videos'},
  CONTENT_APPROVAL_REQUIRED:{title:'Материал ожидает одобрения',body:'Проверьте сценарий перед дальнейшей работой.',tab:'scripts'},
  PUBLICATION_SUCCESS:{title:'Публикация выполнена',body:'Проверьте результат и статус публикации.',tab:'publishing'},
  PUBLICATION_FAILED:{title:'Публикация требует внимания',body:'Откройте публикацию, чтобы проверить ошибку или неопределённый результат.',tab:'publishing'},
  PAYMENT_SUCCESS:{title:'Оплата подтверждена',body:'Оплаченный период и ресурсы доступны в биллинге.'},
  PAYMENT_FAILED:{title:'Платёж требует внимания',body:'Проверьте статус в биллинге. Если результат неизвестен, не создавайте повторный платёж.'},
  SUBSCRIPTION_EXPIRING:{title:'Оплаченный период скоро закончится',body:'До конца последнего оплаченного периода осталось не больше трёх дней. Проверьте тариф и автопродление.'},
  SOCIAL_TOKEN_EXPIRED:{title:'Подключение соцсети требует обновления',body:'Обновите подключение перед следующей публикацией.',tab:'integrations'},
  JOB_FAILED:{title:'Задача требует внимания',body:'Проверьте состояние задачи и доступные действия восстановления.',tab:'jobs'},
};
export class NotificationService {
  constructor(private readonly repository:NotificationRepository){}
  async list(userId:string,tenantId:string,raw:unknown){
    z.uuid().parse(tenantId);const {cursor}=z.object({cursor:z.uuid().optional()}).strict().parse(raw);
    const result=await this.repository.list(userId,tenantId,cursor);
    return {...result,items:result.items.map(item=>({...item,...copy[item.type],href:item.brandId?`/brands/${item.brandId}/content?organization=${tenantId}&tab=${copy[item.type].tab??'jobs'}`:`/billing?organization=${tenantId}`}))};
  }
  markRead(userId:string,tenantId:string,raw:unknown){return this.repository.markRead(userId,z.uuid().parse(tenantId),notificationReadSchema.parse(raw).id);}
}
