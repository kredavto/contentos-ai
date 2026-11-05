# Free-run and source verification, 2026-11-05

GitHub repository metadata confirmed kredavto/contentos-ai is public. GitHub's current billing documentation says standard hosted compute in public repositories remains free independently of the monthly included compute allowance; larger runners do not. This workflow uses only ubuntu-24.04 and refuses execution if the event repository is private. There is no new VM, paid runner, managed service, registry publication or payment.

Source: https://docs.github.com/en/billing/concepts/product-billing/github-actions

Artifact/cache allowance is NOT known. Accordingly the benchmark saves only ephemeral runner files and emits numeric results in normal job logs/summary; there is no artifact upload/cache action. The inherited CI retains ALL its checks, with only cache saving and browser artifact upload disabled for the exact codex/stack-benchmark head branch. Other branches, main and PR #19 retain their previous behavior. GitHub documents that logs/job summaries do not count towards artifact storage. No existing artifacts/caches are deleted and no billing settings are changed.

Verified via Docker Hub public tag APIs (linux/amd64 platform manifests):
- library/postgres:17-alpine: sha256:e4cb93687b062cd25a0e8f672d85a7708235009d70d31f8a7698d9370092a9c4
- library/redis:7-alpine: sha256:ec1c2d3603c3d7d65b153bedda0248b641aa3bd7684503406b27b9e870ac0796
- axllent/mailpit:v1.29: sha256:c5fa09022cf2139438f09461f942d56fab2ed63cdf1a4046467af032fb2403ba
- library/golang:1.24.8: sha256:dd80b4158d9c4ca750687719d1a4b79ec9f78f19c4b87b53b73d552ceccfb7a8

Official MinIO Docker Hub images returned 404, and Quay manifest verification returned 401. No third-party mirror or guessed digest is substituted. Instead the fixture builds official source at commit 9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a, corresponding to vendor security release RELEASE.2025-10-15T17-29-55Z:
https://github.com/minio/minio/commit/9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a

Verified go.mod SHA256: 673f06144e90bc045f0a20050d2874c52e551be5bfbd70dff6e76b66da0db702
Verified go.sum SHA256: 86e062349c7abdce0465561bb409d410a95b00b0969ba05d5fb5f2e3550a5cd4

The build verifies both files, keeps GOTOOLCHAIN local, uses the public Go checksum database, checks downloaded modules, and builds twice with trimpath/buildvcs=false/no build-id, requiring identical binaries. This tests repeatability inside the pinned builder; it is not a claim of independently reproduced provenance on a separate platform. The final image ID/binary hash are observed only after successful build, never fabricated in advance. The resulting image is built once and reused for all modes. Existing pinned Node runtime image is reused as the test-only runtime base.

Source-only MinIO build follows the vendor's current release instructions. This isolated synthetic object store is not a recommendation to deploy this version for real data. No public ports, real credentials or production mounts are supplied.
