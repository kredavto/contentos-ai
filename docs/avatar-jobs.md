# Avatar Studio

Private photo avatars and additional looks use a tenant-owned source photo and a PERSON consent subject from the same brand. The web server enqueues work through a database outbox; the persistent BullMQ worker submits, checks readiness and deletes remote groups. No browser-supplied external avatar ID is accepted. Public catalog discovery remains an adapter capability, not a tenant-private catalog shortcut.

Enable `AVATAR_GENERATION_ENABLED=true`, `AVATAR_PROVIDER=heygen`, server-only `HEYGEN_API_KEY` and private S3 storage on both web and worker. Defaults are disabled. Missing configuration fails with `CONFIGURATION_REQUIRED`. `AVATAR_PROVIDER=mock` is explicit development/test only and visibly labeled DEMO; production configuration rejects it. The user's authorized Yury test through the HeyGen plugin is separate from these application credentials and does not validate the live server adapter.

Creation requires current OWN_LIKENESS or THIRD_PARTY_LIKENESS plus CROSS_BORDER_PROCESSING consent. Jobs retain original evidence IDs: revocation followed by a new grant never reactivates an older job. Membership and consent are checked before submission and before marking ready. Revocation blocks future use; deletion is a separate explicit action.

`CREATE_AVATAR` reserves the database-configured usage policy (initially 5 AI credits, not a claim about HeyGen pricing). Readiness captures once; definitive failure releases once. Unknown submission outcomes retain the reservation until resolved or explicitly canceled by deleting the avatar. Provider cost remains null when not returned. Creation call traces, stable keys and audit events link to each job.

HeyGen documents 24-hour Idempotency-Key response replay for POST /v3/avatars. The worker persists a submission marker before the request, reuses the same key and immutable source/subject intent, and limits replay to 23 hours from the original marker. Three consecutive errors pause automatic work. Normal processing checks do not consume submission retries; after 360 checks they pause for review. Manager resume uses the same operation and refuses expired replay windows. Lease tokens fence worker completion; late accepted references are retained for remote cleanup even after cancellation.

Deletion immediately blocks use and cancels pending work. A persistent cleanup worker deletes the complete remote avatar group. Unknown in-flight creation blocks final deletion until a reference is recovered; the UI states that deletion is still pending. Deleted records have names/references redacted, while audit and financial evidence remain. Source photographs are managed separately in the media library.

Unresolved limitation: an expired unknown submission requires operator investigation with HeyGen. No user-facing/manual reference injection or automatic duplicate creation is provided. The broader support/admin reconciliation workflow and retention policy are still pending. Do not represent such a task as successful or deleted.

Official contracts: https://developers.heygen.com/reference/create-avatar, https://developers.heygen.com/reference/get-avatar-look, https://developers.heygen.com/reference/delete-avatar-group.
