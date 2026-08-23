# U1 Technical Design

## Package Boundary

所有新合同位于 `@data-agent/contracts`，只依赖 Zod 和既有 framework-neutral 类型。禁止导入 Mastra、Next、PostgreSQL SDK 或 App 代码。

## Contracts

- `platform-capabilities.ts`: 58 ID 常量、strict descriptor schema、冻结 U-ID DAG validator、多 Evidence Kinds 和 immutable manifest。
- `greenfield-bootstrap.ts`: 空 Workspace 声明、双 Domain、Source Bundle、Release Genesis、content-addressed Candidate 与 Falcon boundary discriminated unions；不授予发布 Authority。
- `semantic-coverage-policy.ts`: Adapter Candidate set、100% coverage floor、deterministic exclusion and Candidate assessment schemas；U5 再绑定权威 Adapter Registry 与 Schema Snapshot。
- `signer-key-registry.ts`: public verification-key revisions、Ed25519 canonical/main-subgroup validation and role-separated signer assignment；no private material，PoP/activation challenge 由 U5 执行。
- `route-authorization-matrix.ts`: action descriptors、受信 Authority Resolver Port、server-resolved principal/resource/capability/version/idempotency facts 与冻结 authorization decision。

## Security Invariants

- All external input is `unknown` then strict parsed.
- Manifest validation checks exact identity set, duplicate dependency, missing target and cycle.
- Falcon branches reject unknown fields and cross-branch payloads.
- Key registry accepts only canonical public Ed25519 main-subgroup points and stable key identifiers；低阶、非曲线、非 canonical 与含 torsion 点全部拒绝。
- Authorization accepts only facts returned by the server composition Authority Resolver Port；binding 覆盖 action/channel/workspace/principal/resource/version/idempotency/request hash/evidence/freshness，client claims cannot expand access；replay 决策必须使用 `RETURN_RECORDED_RESULT` 且 `authorized=false`，不得再次执行 Effect。
- Create/Register actions require `MUST_NOT_EXIST`，其余 action require `MUST_EXIST`；required 与 not-applicable version/idempotency fields both fail closed.
- Physical FK 与 Join Edge 的 source/target composite column arity 必须相等，并保持 endpoint/constraint/evidence 精确绑定。

## Compatibility

Greenfield only. No legacy reader, backfill, migration-equivalence receipt or compatibility route is introduced.
