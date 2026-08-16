# U1 Implementation Plan

1. Add failing tests for exact 58-ID manifest coverage, frozen U-ID DAG, missing/duplicate/cycle failures, M02 dual evidence and forbidden commercial Evidence Kinds.
2. Implement strict capability descriptors and DAG validation; export through the capability barrel.
3. Add failing Bootstrap/Falcon boundary tests, then implement Greenfield strict schemas and a content-addressed Candidate builder without an authority brand.
4. Add coverage-floor happy/error tests, then implement deterministic Candidate assessment with exact FK/join-edge inventory binding.
5. Add signer registry and route authorization tests, then implement canonical/main-subgroup Ed25519 public keys and a server Authority Resolver Port bound to real target/version/idempotency facts.
6. Write the architecture ledger mapping all 58 IDs to U-ID and Evidence Kind.
7. Run focused Vitest, contracts build/typecheck and root Greenfield integration test.
8. Audit diff against U1 owned paths, stage only those paths and create the U1 scoped commit.

## Owned Paths

- `packages/contracts/src/capabilities/platform-capabilities.ts`
- `packages/contracts/src/capabilities/index.ts`
- `packages/contracts/src/semantic/greenfield-bootstrap.ts`
- `packages/contracts/src/semantic/semantic-coverage-policy.ts`
- `packages/contracts/src/authz/signer-key-registry.ts`
- `packages/contracts/src/workspaces/route-authorization-matrix.ts`
- `docs/architecture/datafoundry-coa-capability-ledger.md`
- U1 tests named in the frozen plan.

## Validation

- `pnpm --filter @data-agent/contracts test:unit -- platform-capability.spec.ts greenfield-semantic-bootstrap.spec.ts semantic-coverage-policy.spec.ts`
- `pnpm --filter @data-agent/contracts typecheck`
- `pnpm --filter @data-agent/contracts build`
- `pnpm exec vitest run tests/datafoundry-coa-greenfield-bootstrap.spec.ts`

## Implementation Result

- 58-ID manifest、64-edge frozen U-ID DAG、M02 dual evidence 与 58-row ledger 已锁定。
- Falcon bootstrap 绑定既有 source commit/digest 与精确 28 schema set；未执行任何导入。
- Greenfield Bundle/Manifest 使用 canonical SHA-256 content-addressed Candidate builder，不再暴露 `Verified`/WeakSet/Authority 品牌；真实空库状态明确留给 U5 PostgreSQL 事务核验。
- Semantic Coverage 关闭空集、跨 relation ID、adapter、dangling FK、缺失/多余 join-edge 与 composite endpoint arity 绕过；结果保持 Candidate，U5 绑定权威 SchemaSnapshot/Adapter Registry。
- Route authorization 通过 async Server Authority Resolver Port 解析 principal/resource/capability/version/idempotency/evidence/freshness；18 个 action 均覆盖 target state、required/not-applicable 字段，replay 强制 `RETURN_RECORDED_RESULT` 且不可再次执行。
- Signer Registry 只接受 canonical 32-byte Ed25519 主子群 JWK public material，拒绝 identity、order-2、non-curve、non-canonical 与 mixed-torsion 点；PoP/activation challenge 留给 U5。
- Scoped validation：contracts unit `50 files / 650 tests`、contract `7 tests`、U1 integration `9 tests`、contracts typecheck/build、scoped Biome 全部通过。
- Repository-wide typecheck 的 16 个任务中 15 个通过；唯一失败来自非 U1 的 Web fixture 缺少 `ResolvedSystemModel.capabilities`。Repository-wide lint 的非 U1 路径仍有 `21 errors / 63 warnings`；U1 owned paths scoped lint 全绿。
