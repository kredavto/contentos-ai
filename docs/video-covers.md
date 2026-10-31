# Cover Studio

New video requests may save an initial cover design. Once a video is READY, Cover Studio can render additional versions from the stored final MP4 without invoking HeyGen or re-encoding the video. The editor opens the real video for seeking, records the chosen timestamp to millisecond precision, and also offers five relative frame positions. FFmpeg decodes the frame at the selected time, clamped before the end. Designs include an editable 80-character headline, frame with colored panel or solid background, three DejaVu font presets, top/center/bottom layout and hex text/background colors. Long headlines wrap automatically. Old videos retain their original thumbnail as version 0.

## Durable generation and accounting

Migration 0044 adds covers, video selection/revision fields and a GENERATE_COVER usage policy (initially 1 AI credit). A verified content writer requests a version through the service/repository boundary. The actor-bound idempotency key includes the design and project, one pending version is allowed per video, and a hard limit of 50 additional versions bounds retained storage and work. The server reserves the configured price atomically with insertion. Polling an existing version is free; rendering another version is a new metered operation.

The database row is the durable dispatch record for the contentos-covers BullMQ queue. Stable job IDs, ten-second redispatch recovery, database leases, three attempts and exponential retry recover lost deliveries and workers. Each run has a 240-second abort budget under a five-minute lease. It checks the current actor, tenant, video/script and likeness consent before reading, again before upload, and before success. Success captures once; terminal failure or video deletion releases a held reserve. A new version remains unselected until the user chooses it.

FFmpeg/libass accepts only local bounded MP4 bytes and server-chosen paths. The design is Zod-validated; ASS override characters are neutralized and the filtergraph receives only allowlisted presets, validated colors and computed coordinates. JPEGs use the video resolution, with a 3 MiB limit. Temporary directories are removed in finally. Docker includes DejaVu fonts; local font fallback may differ.

## Selection, approval and deletion

Versions preserve immutable design and identity fields through a database trigger. Selection checks an optimistic video cover revision and requires a READY version of that same tenant/video. It changes the poster key and clears video approval. Approval must name the current cover revision, so a stale browser cannot approve a changed cover; selecting the already selected version is a no-op. Selection is blocked while a publishing task referencing that video is SCHEDULED, PREPARING, SUBMITTING or RECONCILIATION. Existing published deliveries are never changed. The user must cancel an eligible pending publication first, choose the cover and reapprove the video.

Read-only members can inspect versions and use 120-second private download links. No storage keys or provider credentials are returned in the version listing. No new cover is auto-published. Current publishing adapters do not send these JPEGs as platform custom thumbnails; the cover is an application poster and downloadable asset.

Deleting the video blocks new application access immediately (previous signed links expire within 120 seconds), cancels pending cover tasks, releases held credits, fences their completion and extends the deletion grace through the last active cover lease. Storage cleanup removes the original poster, selected poster and all version objects; bounded parallel deletions finish before the cleanup lease. Only after cleanup succeeds are the design payloads scrubbed. Version numbers, job outcome metadata and content-free audits remain. Failed-generation objects are also included in cleanup. Removing individual versions is not currently offered.

## Verification and limits

Integration tests cover concurrent idempotency, role/brand ownership, immutable design, one capture, retry exhaustion/refund, expired/stale leases, disabled actors, scheduled-publication selection denial and deletion during rendering. Real FFmpeg tests cover Unicode, safe text, colors/layouts, relative and absolute frame choice and standalone cover rendering. Chrome exercises generation, seeking, preview, selection, approval reset and mobile layout through the worker and private fixture storage.

AI headline suggestions and uploaded-image backgrounds are not implemented. Headline edits and solid/frame backgrounds are available. No actual provider charge, external publication or infrastructure readiness is implied by fixture testing.

References checked 2026-10-12: [FFmpeg ASS filter](https://ffmpeg.org/ffmpeg-filters.html#ass), [drawbox](https://ffmpeg.org/ffmpeg-filters.html#drawbox). Uses filename-based ASS rather than newer inline-script options.
