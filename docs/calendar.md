# Content planning calendar

Calendar entries belong to a tenant, brand and ContentItem. A plan can hold SHORT_VIDEO, POST, CAROUSEL, STORY or IMAGE, a caption, hashtags, platform, privacy, comment preference and MANUAL/APPROVAL mode (approval is the default). It can reference a ready, explicitly approved video from the same brand. The service rechecks the current approved script and original consent evidence before creating or updating that reference.

The calendar is a durable editorial plan. A planned date is not a publishing job or a claim of publication. Social connections and the publishing scheduler must be connected in a subsequent workflow before any material is sent externally. The UI explicitly states this limitation. Autopilot cannot be selected through this API.

Times are stored as PostgreSQL timestamptz UTC plus the user's IANA time zone. The API accepts a wall-clock minute and resolves it with Intl time-zone data. Nonexistent DST minutes are rejected; repeated minutes require EARLIER or LATER. Existing entries retain the original occurrence when edited. Moving a card to an ambiguous minute requires using the editor to choose the occurrence. Queries use half-open UTC windows of at most 62 days and a bounded 500-entry result; narrow the view for larger calendars.

Creating uses a UUID intent key and payload hash under a tenant lock. Editing/moving/canceling uses optimistic revisions. Canceled entries remain for audit but are excluded from the board. Tenant and verified writer roles are checked for mutations; readers can see plans. No provider credentials or external IDs enter the calendar response. No generation credits are charged for editing a plan.

The board offers day, Monday-based week and month views, a display time zone, HTML drag/drop, and an equivalent keyboard/mobile date editor. Monthly navigation advances by calendar month. Stored times remain UTC when changing the display zone. The form exposes publication preferences as desired settings; a future platform adapter must validate its supported options rather than assuming every network supports every setting.
