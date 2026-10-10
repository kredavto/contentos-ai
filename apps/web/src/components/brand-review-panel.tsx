import type { GenerationService } from '@contentos/core';
type Review = Awaited<ReturnType<GenerationService['overview']>>['reviews'][number];
const categories = { BRAND_RULE: 'Правило бренда', TONE: 'Тон', FACT_CHECK: 'Нужна проверка фактов' };
export function BrandReviewPanel({ reviews, scriptVersion, brandRevision }: { reviews: Review[]; scriptVersion: number; brandRevision: number }) {
  return <section className="stack" aria-label="Отчёты Brand Guardian">
    <h3>Brand Guardian</h3>
    <p className="notice warning">Редакторская помощь AI, не одобрение и не подтверждение фактов. Источники в интернете не проверяются. Отсутствие замечаний не гарантирует точность или соответствие правилам. Отчёт относится только к указанным версиям.</p>
    {!reviews.length ? <p>Для этого сценария ещё нет отчётов в последних 50 проверках бренда.</p> : null}
    {reviews.map(review => <article className="panel" key={review.id}>
      <h4>Проверка сценария v{review.scriptVersion} · бренд v{review.brandRevision}</h4>
      {review.scriptVersion !== scriptVersion || review.brandRevision !== brandRevision ? <p className="notice warning">После этой проверки сценарий или правила бренда изменились. Запустите новую проверку.</p> : null}
      {review.provider === 'mock' ? <p className="badge">ДЕМО-ОТЧЁТ</p> : null}
      <p className="preserve-lines">{review.content.summary}</p>
      {!review.content.findings.length ? <p>AI не отметил замечаний. Проверьте текст самостоятельно.</p> : null}
      {review.content.findings.map((finding, index) => <div key={index} className="stack">
        <strong>{categories[finding.category]} · {finding.field.toUpperCase()}</strong>
        <blockquote className="preserve-lines">{finding.quote}</blockquote>
        {finding.ruleIndex !== null && review.rules[finding.ruleIndex] ? <p className="preserve-lines">Правило из снимка бренда: {review.rules[finding.ruleIndex]!.name} — {review.rules[finding.ruleIndex]!.description}</p> : null}
        <p className="preserve-lines">{finding.explanation}</p>
        <p className="preserve-lines">Предложение: {finding.suggestion}</p>
      </div>)}
    </article>)}
    <small>Показаны отчёты этого сценария из последних 50 проверок бренда. Предыдущие версии сохраняются.</small>
  </section>;
}
