# U1 Technical Design

## Package Boundary

所有新合同位于 `@data-agent/contracts`，只依赖 Zod 和既有 framework-neutral 类型。禁止导入 Mastra、Next、PostgreSQL SDK 或 App 代码。

## Contracts

- `platform-capabilities.ts`: 58 ID 常量、strict descriptor schema、DAG validator 和 immutable manifest。
- `greenfield-bootstrap.ts`: 空 Workspace、双 Domain、Source Bundle、Release Genesis 与 Falcon boundary discriminated unions。
- `semantic-coverage-policy.ts`: Adapter capability set、100% coverage floor、deterministic exclusion and validation result schemas.
- `signer-key-registry.ts`: public verification-key revisions and role-separated signer assignment; no private material.
- `route-authorization-matrix.ts`: action descriptors and pure authorization evaluation input/output.

## Security Invariants

- All external input is `unknown` then strict parsed.
- Manifest validation checks exact identity set, duplicate dependency, missing target and cycle.
- Falcon branches reject unknown fields and cross-branch payloads.
- Key registry accepts only public Ed25519 material and stable key identifiers.
- Authorization accepts server-derived role/scope/capability facts; client claims cannot expand access.

## Compatibility

Greenfield only. No legacy reader, backfill, migration-equivalence receipt or compatibility route is introduced.
