# Security model

Deny by default. Every request authenticates, validates input, checks current membership/action/tenant ownership and invokes a domain service. Parameterized SQL, React output encoding, bounded payloads and untrusted prompt isolation address injection. No client-controlled role grants. Tenant authorization is repeated by asynchronous jobs; revocation is effective before external execution.

Sessions: high-entropy opaque tokens, hash-only DB storage, expiry, revocation, secure HttpOnly SameSite cookies and Origin checks for unsafe requests. Passwords use scrypt; login/reset responses avoid account enumeration. Rate limiting is shared across instances. Verification and reset tokens are single-use with expiry.

Provider credentials remain server-side, encrypted with authenticated encryption and key versions. Logger uses an explicit safe event schema. Signed download URLs have short expiry. Validate URLs against SSRF, disallow private/link-local networks and redirects to blocked destinations. Uploads need size/type checks, private storage and controlled media processing.

Webhook receipts are durable and deduplicated; signatures are checked when supported. Where provider does not sign, fetch authoritative resource through authenticated API and compare expected ownership, amount and status before changing state. Do not invent a signature scheme.

OWASP release review: broken access control (tenant/role adversarial tests), cryptographic failures (secrets/tokens), injection (SQL/prompts/FFmpeg), insecure design (approval/ledger invariants), misconfiguration (production env validation), vulnerable components (lockfile/dependency audit), auth failures (sessions/throttling), integrity failures (webhooks/CI), logging failures (redacted audit), SSRF (external/media URLs).

Open risks and verification evidence must be recorded before declaring production readiness. RU_DATA_RESIDENCY requires infrastructure placement verification and separate assessment of cross-border provider operations.
