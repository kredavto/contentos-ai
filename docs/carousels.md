# Carousel Studio

The Carousel tab generates 2–10 editable text slides through the existing provider-independent structured LLM workflow. Brand Brain supplies context; every output is strictly validated. GENERATE_CAROUSEL reserves 4 AI credits from the database policy, captures on success and releases on terminal failure. Durable jobs, actor-bound idempotency and approval notifications use the existing worker pipeline.

Each carousel has immutable numbered JSON versions containing slides, caption, hashtags, internal fact-check notes and a design preset. Editing creates a version and clears approval. Optimistic version checks prevent overwriting concurrent edits. Writers and approvers have distinct permissions; viewers can read history and export approved slides. Tenant composite foreign keys and database history triggers provide defense in depth.

The browser renders actual PNG slides at 1080×1080 or 1080×1350 with selectable colors and sans/serif typography. Text wraps and shrinks within bounded regions; excessive text reports an error. Rendering uses local Canvas2D, with no remote fonts, image fetches, HTML or SVG. Fonts can vary between devices. Downloads require the currently selected saved version to be approved and unchanged. PNGs download individually and are not persisted as media assets.

An approved carousel can prefill an independent CAROUSEL calendar draft with its caption and hashtags. Internal title/notes are excluded from copied publication text. This does not enqueue publishing or attach files: the user downloads and attaches slides during manual publication. Current publishing adapters do not send carousel albums. AI illustrations, server-side media storage/ZIP export, album publishing and carousel deletion remain separate work.

Migration 0045 adds carousels and carousel_versions plus the usage policy and immutable-history trigger. No new provider credentials are required.
