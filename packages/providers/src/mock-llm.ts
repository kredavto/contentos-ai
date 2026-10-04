import { DomainError, generationInputSchema, type LLMProvider, type OperationContext, type GenerationOutput, performanceEvidenceSchema, performanceDimensions, type PerformanceOutput } from '@contentos/types';
/** Explicit local/CI fixture. Never registered in production. */
export class MockLLMProvider implements LLMProvider {
  readonly name = 'mock';
  constructor(environment: string) { if (environment === 'production') throw new DomainError('CONFIGURATION_REQUIRED',503); }
  async generate(input: Parameters<LLMProvider['generate']>[0], context: OperationContext) {
    context.signal.throwIfAborted();
    const request = JSON.parse(input.prompt.split('\nThe previous response')[0]!) as { workflow: string; sourceData: unknown };
    if(request.workflow==='OPTIMIZE_STRATEGY'){
      const data=request.sourceData as {evidence:unknown};
      const evidence=performanceEvidenceSchema.parse(data.evidence);
      const json:PerformanceOutput={summary:'[ДЕМО] Проверка сохранения анализа. Это тестовый отчёт, а не оценка эффективности.',limitations:['ДЕМО: выводы и рекомендации подготовлены тестовым провайдером.','Нет измеренных разбивок по аудитории; причинные выводы недоступны.'],findings:performanceDimensions.map(dimension=>({dimension,status:'INSUFFICIENT_DATA',explanation:'[ДЕМО] Для достоверного сравнения нужны сопоставимые измерения.',metric:null,evidenceIds:[]})),recommendations:[{title:'[ДЕМО] Проверить понятность CTA',rationale:'Гипотеза для проверки; улучшение не доказано.',hypothesis:'Более конкретный призыв может помочь читателю выбрать следующий шаг.',successMetric:'clicks',successRule:'Измерить клики у сравнимых публикаций через одинаковое время.',horizonDays:14,evidenceIds:evidence.publications.flatMap(row=>row.observation?[row.observation.id]:[]).slice(0,1),patch:{field:'hypotheses',value:['[ДЕМО] Проверить конкретный CTA по измеренным кликам.']}}]};
      return {json,usage:{model:'mock-v1',inputUnits:0,outputUnits:0,costMicrounits:0,currency:'USD'}};
    }
    const { brain, options } = generationInputSchema.parse(request.sourceData);
    const topic = options.topic || brain.products[0]?.name || brain.company;
    const cta = options.cta || brain.ctas[0]?.name || 'Узнайте подробнее';
    let json: GenerationOutput;
    if (request.workflow === 'GENERATE_STRATEGY') json = {
      positioning: `[ДЕМО] ${brain.usp || brain.company}`, audienceSegments: [brain.audience[0]?.name || 'Аудитория бренда'], pains:[brain.pains[0]?.name || 'Нужна ясность'], desires:['Понятный результат'], objections:['Подойдёт ли мне?'],
      contentPillars:[{name:'Практические советы',purpose:'Помочь аудитории разобраться'}], toneOfVoice:brain.voice || 'Понятный', formats:['Пост','Короткое видео'], frequency:'Одна публикация в день', funnelStages:['AWARENESS','CONSIDERATION'], ctas:[cta], leadMagnets:[brain.leadMagnets[0]?.name || 'Идея: полезный чек-лист'], hypotheses:['Гипотеза: практические примеры вызывают интерес'],recommendedChannels:[options.platform],
      plan:Array.from({length:30},(_,i)=>({day:i+1,topic:`[ДЕМО] ${topic}: совет ${i+1}`,platform:options.platform,format:'POST',funnelStage:'AWARENESS' as const,cta})),
    };
    else if (request.workflow === 'GENERATE_IDEAS') json = {ideas:Array.from({length:5},(_,i)=>({title:`[ДЕМО] ${topic}: идея ${i+1}`,angle:'Практический разбор',hook:`Что важно знать о ${topic}?`,audienceSegment:brain.audience[0]?.name || 'Аудитория бренда',contentPillar:'Практические советы',funnelStage:'AWARENESS' as const,platform:options.platform,format:'SHORT_VIDEO' as const,scores:{relevance:70,novelty:50,brandFit:75,conversionPotential:40,viralityPotential:30},rationale:'Демонстрационная редакционная оценка, не прогноз.'})),caveat:'ДЕМО: оценки условные, результат не гарантирован.'};
    else json = {hook:`[ДЕМО] Как разобраться в ${topic}?`,context:`Материал для ${brain.audience[0]?.name || 'аудитории бренда'}.`,core:`Начните с потребности. Сравните варианты. Проверьте, соответствует ли ${topic} вашей задаче.`,proof:'Добавьте проверенный пример из собственной практики.',cta,factCheckNotes:['Демонстрационный текст. Фактические утверждения требуют проверки.']};
    return {json,usage:{model:'mock-v1',inputUnits:0,outputUnits:0,costMicrounits:0,currency:'USD'}};
  }
}
