import {z} from 'zod';
const count=z.number().int().min(0).max(1_000_000_000_000).nullable().default(null);
const seconds=z.number().min(0).max(1_000_000_000_000).nullable().default(null);
export const normalizedMetricsSchema=z.object({views:count,impressions:count,reach:count,likes:count,comments:count,shares:count,saves:count,watch_time:seconds,average_watch_time:seconds,completion_rate:z.number().min(0).max(1).nullable().default(null),clicks:count,followers_delta:z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000).nullable().default(null)}).strict();
export type NormalizedMetrics=z.infer<typeof normalizedMetricsSchema>;
export const metricLabels:Record<keyof NormalizedMetrics,string>={views:'Просмотры',impressions:'Показы',reach:'Охват',likes:'Лайки',comments:'Комментарии',shares:'Репосты',saves:'Сохранения',watch_time:'Время просмотра, секунд',average_watch_time:'Среднее время просмотра, секунд',completion_rate:'Доля досмотров (0–1)',clicks:'Клики',followers_delta:'Изменение подписчиков, связанное с публикацией'};
export const manualMetricsSchema=z.object({publicationId:z.uuid(),idempotencyKey:z.uuid(),observedAt:z.iso.datetime({offset:true}),sourceNote:z.string().trim().min(3).max(500).refine(value=>Array.from(value).length>=3),metrics:normalizedMetricsSchema.refine(value=>Object.values(value).some(item=>item!==null),'At least one observed metric is required')}).strict();
export type ManualMetrics=z.infer<typeof manualMetricsSchema>;
