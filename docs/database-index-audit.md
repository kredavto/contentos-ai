# Database lookup audit

Migration `0095_user_reference_lookup_indexes.sql` adds 44 B-tree indexes without dropping existing indexes or changing records. It is an additive custom Drizzle migration with the generated journal/snapshot. Once applied, it must not be edited.

## Identity reference checks

The account-erasure dependency check discovers direct foreign keys to `public.users` from the PostgreSQL catalog and checks for retained references before admitting erasure. An isolated catalog audit found 60 single-column references: 24 had suitable leading indexes and 36 did not. Tenant-first indexes cannot serve a global user lookup without a tenant predicate.

The migration supplies all 36 missing leading user-reference indexes. Eight nullable references use `WHERE column IS NOT NULL`; an equality lookup on a UUID implies that predicate. Account-erasure validation now explicitly rejects foreign keys targeting a user column other than `id`, as well as composite references, with `CONFIGURATION_REQUIRED` before issuing UUID comparisons. Unknown retained product references continue to block erasure; this change does not expand erasure scope.

## Tenant read paths

Eight additional indexes support tenant/workspace brand lists; tenant/brand/status content lists; tenant or tenant/brand job history; tenant or tenant/unit usage history; and publishing-job content or tenant/brand lookups. Existing scheduling, queue and uniqueness indexes remain intact. This is a targeted query-pattern audit, not a claim that every application query is optimized.

## Verification and deployment

The focused disposable PostgreSQL suite verifies that every current single-column user foreign key has a valid, ready leading B-tree index, including supported partial indexes. It also verifies explicit denial for a synthetic email-targeting foreign key and a planner-selected indexed absent-user lookup over 20,000 synthetic retained action records, without forcing planner settings. The isolated checkpoint passed three tests; complete acceptance is recorded in IMPLEMENTATION_STATUS.md.

These checks establish local index coverage and a representative query plan. They do not establish production p95, realistic cardinality/distribution, load capacity or index-build duration. Ordinary transactional index creation can block writes while building; schedule migration capacity and a maintenance window for large existing tables. Apply through migration 0095 before running the matching account-erasure worker. No production migration or data deletion was performed.
