# Post Writer

The Posts tab generates a standalone plain-text social post from the completed structured Brand Brain and a selected topic/platform. GENERATE_POST uses the existing outbox/BullMQ worker, LLM abstraction, strict schema validation/repair, recorded provider calls and immutable reserve/capture/release accounting. Its initial database policy is two AI credits. Missing credentials report configuration requirements; mock results are explicitly marked demo.

Output separates the internal title, public body, hashtags and fact-check notes. Text export and the calendar copy include only body/hashtags. The model must not invent evidence or guarantees; notes require human review, not automated verification. Platform delivery limits are enforced by the existing publishing adapter, so an overlong post may need shortening before delivery.

Verified OWNER/ADMIN/MANAGER/EDITOR members may generate/edit. OWNER/ADMIN/MANAGER/CLIENT_APPROVER may approve the current saved version. VIEWER may read. Generated posts also produce the existing durable approval notification for approvers, with a link to the Posts tab. Every edit appends immutable content_versions, advances the current version and clears previous approval. Concurrent/stale saves fail instead of overwriting text. Approval is idempotent for the same current version. Jobs use actor-bound idempotency, current tenant/brand authorization and permission rechecks at completion. Audits contain identifiers/version numbers, not post text.

An approved saved post can prefill a new calendar draft. This is an explicitly labeled independent editable copy, not a live binding: later edits to the post do not silently change a scheduled publication. The user reviews date/text and saves the plan; sending still requires the existing separate publishing approval. This action never dispatches a publication automatically.

The studio lists the latest 100 posts and latest 100 versions per post. Broader pagination, AI rewrite of existing posts and additional social delivery adapters remain future work. This is text generation/editing, not image/carousel generation or a new external publishing integration.
