# Preflight Evidence

- Branch: `feat/datafoundry-platform-modules`
- Start HEAD / plan commit: `db9ad7a2a8de35302b34a45d4a8c26b18296e931`
- Plan SHA-256: `fd947c8bf0fb7e9af81dfa905e5ea7c97f6b16ac8e56b238b8c5acd5d2e32071`
- Provider: DeepSeek API, requested and observed model `deepseek-v4-flash`
- Credential smoke: request shape, structured output, tool calling, streaming and sanitized error normalization all PASS; receipt state `PENDING_RECEIPT_COMMIT`.
- Claude/Anthropic: prohibited for this Goal.
- Falcon bundle: READY, source commit `8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5`, digest `sha256:20ad41ba54d24f70d69a981907ed223ccd7bc6ab0a5894f8e417c567c1d5df4e`, 28 databases, 500 cases (309 DEV, 191 TEST), 5 compatibility fixtures.
- Falcon database: existing immutable import receipt count is 1. No data import is authorized by this Goal.
- Mastra: `@mastra/core` 1.52.1 from lockfile; public contracts must not export Mastra types.
- DeepSeek Harness reference: commit `47f943859bef60e4160492346772ded9b24f765a`.
- Mastra reference: commit `57b032df3c2b414f3d7b2efd36fc0a58711a5259`.
- PostgreSQL, migrations and local ports: `pnpm dev:check` PASS.
- Ed25519 admin/attestor generation and verification: PASS in Node crypto; persistent keys and registry are materialized by U1/U5 before LaunchAuthorization is consumed.
- Billing, migration/backfill, additional dataset import and destructive cleanup are excluded.
