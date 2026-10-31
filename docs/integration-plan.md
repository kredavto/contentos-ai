# Combined acceptance candidate — 2026-10-28

This draft combines existing reviewed changes, not new features. Its parent is
PR9 `c88f6361f71b3a7f8300f9cf75b981b07c1baba1`, which already contains PR5
`1b4b55303c561b57908dfc1610fe9716a2e9846c`, PR4
`449efe9323705a78a5cf2db3e70dd736242ca2af` and PR2
`e9905429f9a66e0a074e704ea325ee69b494c519`.

Added once each:
- PR6 BYOK scope: `1f2c2a05802132b50f7a3ef2d3f8c3fa11a8ecf4`.
- PR7 SMTP cancellation: `7e39c7b22e48ef2fdcc78e28b4b2c6211d80fd23`.
- PR8 request byte budget: `8846e466068edfa0aa11400458cfa1ffda267fe1`.

The user explicitly approved this separate integration draft and common CI.
Original branches remain unchanged. This does not authorize merging, deploying,
provisioning paid services or sending live provider/email requests.

## Recovery and evidence

The previous local candidate passed types, lint, build and 424 tests, with 536
PostgreSQL/Redis-dependent tests skipped. An independent review passed 114 focused
tests and compared all 30 changed source/test paths against their published
versions. The cloud workspace was subsequently replaced and its local patch was
not available. All remote source SHAs were reverified unchanged before rebuilding
this candidate from those exact published commits. All 30 source/test paths again
match byte for byte. Documentation was deliberately consolidated; this is not a
claim that the unavailable previous complete tree or patch hash was recovered.

Individual PR CI succeeded, but only full combined exact-head CI can establish
compatibility. Required gates: migrations through 0095, full PostgreSQL/Redis
regression with no skips, TypeScript, ESLint, production build and all 38 Chromium
scenarios. Record terminal results in the PR. No migration, lockfile, CI workflow
or provider behavior beyond the source PRs is added here.

## Remaining integration and production gates

Before any merge, obtain explicit authorization and choose one coherent path:
either dependency-ordered integration of original PRs with careful retargeting,
or a reviewed consolidated path, never blindly both. Recheck source SHAs and
rerun acceptance after relevant base changes. Preserve original branches and
recovery artifacts until the chosen path is verified.

Old plan-limit commit `a39a7f7` and `/workspace/contentos-plan-limits.patch` from
another environment remain unavailable. Do not recreate them blindly or guess
the next migration number. Recovery requires the actual patch or access to its
original environment, then verification of parent, hash, changed paths and
migration overlap in an isolated worktree.

Production database, Redis, storage, worker, SMTP and provider configuration,
backups, live acceptance and deployment placement remain separate. Process-local
breakers are not distributed/durable protection; byte limits are not exact token
or plan budgets. No project-wide completion increase is claimed.
