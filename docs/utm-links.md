# Brand UTM links

The brand content studio's UTM tab builds and saves tagged HTTP(S) URLs for manual insertion into publication captions/CTAs. It accepts a label, destination, required source/medium/campaign and optional term/content. Existing query parameters whose names start with `utm_` (case-insensitive) are replaced; other query values, duplicates and fragments remain. URLSearchParams encodes values, including Cyrillic text. Destination normalization uses the standard URL parser. Relative URLs, unsupported schemes, embedded credentials, whitespace/control characters and oversized fields are rejected. The final URL is limited to 4096 characters.

The shared pure builder provides a browser preview and authoritative server construction. There is no server fetch, public redirect, shortener or tracking endpoint. Copying is explicit, with a manual textarea fallback if the browser refuses clipboard access. URLs never render as injected HTML. The UI does not claim that visits or leads are measured; attribution requires analytics on the destination and remains a separate funnel task.

Migration 0040 adds `utm_links` with composite tenant/brand ownership, creator, request key/hash, immutable-through-API URL fields, archive timestamp and optimistic revision. A tenant lock serializes creation/archive operations with membership changes. Verified OWNER/ADMIN/MANAGER/EDITOR members may write; current members may read. Authorization precedes idempotency lookup, so a removed member cannot replay an old request. The same actor/key/input returns the existing link (including archived state); changed input, actor or brand conflicts. Read/response projections exclude request hashes, keys and creator IDs.

Routes under `/api/organizations/:tenant/brands/:brand/utm`:

- GET accepts `status=ACTIVE|ARCHIVED` and optional `before` UUID. Pages use stable descending UUID order, at most 50 rows and a next cursor; this is not chronological ordering.
- POST accepts the fields plus an idempotency UUID. Origin, authenticated-session, mutation-rate and JSON-body controls apply.
- POST `/:id/archive` accepts revision and desired archive boolean. Already-matching state is a no-op; stale state changes conflict. Restoration does not change URL data. Archiving only organizes the library and cannot disable an already distributed destination URL.

Audit records contain actor/tenant/resource/action and correlation IDs, never URLs or campaign text. No paid provider, DNS, SMTP or new remote service is required. Full click-to-lead attribution, content-to-CTA relations, lead forms, messenger integration and the larger funnel module are not implemented by this slice.
