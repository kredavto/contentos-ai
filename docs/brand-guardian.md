# Brand Guardian script review

The script editor can request an advisory review of a saved script version against the current structured Brand Brain, tone and rules. Unsaved text must be saved first. This does not modify the script, brand or approval state. It is not an external fact-checking service, compliance certification or permission to publish.

`REVIEW_SCRIPT` uses the existing authenticated job endpoint, BullMQ/outbox, provider abstraction, bounded structured-output orchestration, retry/cached-result processing and immutable credit ledger. Its initial database usage policy is two AI credits; UI reads the policy. Missing provider configuration is reported normally. Mock mode explicitly produces a demo report and is unavailable in production.

Verified OWNER/ADMIN/MANAGER/EDITOR members may request a review. Current members may read reports. Job creation checks current script and brand revisions under tenant serialization and snapshots the actual stored script version; a supplied text snapshot cannot substitute another script. Actor-bound idempotency protects repeated submissions. Worker completion rechecks membership. A later script/brand edit does not erase the older report or cause it to be attached to the newer version. The UI marks these reports as stale. Failed processing releases the reservation, success captures it once.

Strict output contains a summary and at most 20 findings: BRAND_RULE, TONE or FACT_CHECK. Every finding identifies a script field, quotes an exact substring, and gives an explanation/suggestion. Only BRAND_RULE may reference a zero-based existing rule in the immutable input. Semantic validation is applied to fresh responses, cached responses and repository completion. Invalid responses enter the existing bounded repair flow. Unknown fields and invented quote/rule references are rejected.

FACT_CHECK is a flag for human verification, not a truth verdict. The workflow does not browse, retrieve evidence or verify external sources. There is no automatic rewrite, approval, numeric safety score or claim that absence of findings means correctness. Users must evaluate suggestions and perform their own source review.

Migration 0042 adds immutable reports, the version foreign key and the database usage policy. UPDATE/DELETE triggers protect report history. The studio displays reports for the selected script from the latest 50 brand reviews; older records remain stored. Dedicated paginated full review-history browsing and external evidence-backed fact-check integrations remain future work.
