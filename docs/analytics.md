# Publication observations

The Analytics tab supports manually observed publication metrics. This is a partial analytics delivery, not an automatic provider integration or AI performance analysis.

`publication_metrics` stores an immutable normalized snapshot, observation time, server recording time, author, MANUAL provenance and a bounded source note. Count metrics are nonnegative integers; watch time and average watch time are seconds; completion rate is a fraction in [0,1]. Attributable follower change may be signed. Missing measurements are null, never inferred as zero. All twelve normalized fields are present. At least one measurement is required. Only verified owners, administrators and managers may record observations; all current members may read them.

The observation must be at or after the saved publication acknowledgement and no later than server time. Each submission is idempotent within its tenant, binds its original author and normalized input, and creates an audit event. The tenant/publication composite foreign key and brand joins protect ownership. Updates and deletes are rejected by a database history trigger. Corrections are new observations; use the same observation time to correct a prior snapshot. The UI shows the latest observation by observation time, then recording time and ID. Backdated entries remain historical. Missing values in a later snapshot stay missing; prior values are not silently carried forward. There is no summation across repeated observations and no invented aggregate engagement rate.

The overview contains the latest 100 publications, with one latest observation per publication. History returns the latest 100 observations for the selected publication. These explicit display limits are not data retention rules. Observation times are stored in UTC; the form and display use the browser timezone. Notes are rendered as plain text, never fetched as URLs. Credentials, raw provider references and private media keys are absent from analytics responses.

Routes under `/api/organizations/:tenant/brands/:brand`:

- GET `/analytics`: publication overview with latest observation or null.
- POST `/analytics`: validated manual observation with a UUID idempotency key.
- GET `/analytics/:publication`: observation history.

These local database operations need no asynchronous worker or external API request. Cookie authentication, exact-origin mutation protection and existing API throttling apply.

## Provider boundary and remaining work

Telegram's official [Bot API](https://core.telegram.org/bots/api) does not expose a generic post-view analytics endpoint. Its [getChatMemberCount](https://core.telegram.org/bots/api#getchatmembercount) returns channel/chat membership, not publication reach or attributable follower change. No unavailable post metric is represented as measured zero. Manual observations are not API-verified statistics. The demo publisher remains explicitly labeled in analytics.

On-demand FETCH_ANALYTICS jobs and separate channel membership observations/evidence are now implemented; see [channel analytics](channel-analytics.md). Automatic post metrics, recurring collection, full raw-evidence retention/redaction, paginated exports, charts and AI Performance Analyst/StrategyRecommendation accept/reject remain outstanding. No live analytics requests or paid operations are performed by this slice. Future recommendations must cite observation scope/provenance and must never silently edit Brand Brain.
