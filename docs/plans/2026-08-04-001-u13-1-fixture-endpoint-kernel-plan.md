---
title: "U13.1 Fixture Endpoint Kernel 实施计划"
type: plan
date: 2026-08-04
origin: .trellis/tasks/07-25-data-agent-reset-refactor/implement.md (Section 8.6)
status: active
---

# U13.1 Fixture Endpoint Kernel 实施计划

## Summary

在已交付的 U13.0 贡献合同与 Profile 门禁基础上，实现 **U13.1 Fixture Endpoint Kernel**。该 Kernel 只做 Fixture 范围内的端点证据可行性证明，不注册 F9 产品能力，不自签正确性。Kernel 输出 sealed `AttributionKernelEvidence@1`（状态固定为 `KERNEL_CANDIDATE_ONLY/HOLD`），后置 U7 Eval 才能签发 `AttributionFeasibilityVerdict`。

---

## Problem Frame

implement.md 8.6 定义 U13.1 的严格约束：

- 输入只能是 hash-pinned `origin=FIXTURE` profile 与 `ContributionTruthContract@1` ref/hash
- outcome、每个 driver 与 independently observed residual 的 baseline/follow-up 必须走 U5→U6 QueryEvidence 链
- 每个静态 template 实例化为运行时 `EndpointExecutionBinding`，携带 exact 五轴 VersionFrontier ref/hash
- `SameFrontierWitness` 防止 IDENTITY/principal 等跨轴拼接
- 独立 verifier 按 `EndpointLoweringRuleSet@1` 签发 `EndpointLoweringCertificate@1`
- Kernel 只从两端证据计算 signed delta，产出 `DerivedDeltaObservationSet@1`
- 编译期 `StaticDriverCapacityProof@1` + 执行期 `RunDriverBudgetAdmission@1` 双层预算
- `computed_closure_error`、`independently_observed_residual_delta`、`unexplained_remainder` 三字段分离
- `FixtureConclusionPolicyManifest@1` + `FixtureConclusionDecisionSeal@1`（M1 范围）
- `closure_verdict=PASS | HOLD | REFUSE`
- 固定携带 Core L2=`HOLD`、Attribution F9=`NOT_REGISTERED`、Fixture Evidence=`HOLD`
- 不自签 `AttributionFeasibilityVerdict`，不注册 F9，不产生 `PublishedAttributionSafetyVerdict`

当前代码状态：
- `packages/contracts/src/attribution/` 已有 profile、truth-contract、evidence、conclusion、conclusion-policy、capability、safety 等基础 schema
- `packages/research/src/attribution-fixture/kernel.ts` 存在一个**简化版 stub**：只有 pattern matching 逻辑，没有 delta observation、budget、lowering certificate、frontier witness、closure receipt 等核心能力
- 没有实现 `DerivedDeltaObservationSet@1`、`SameFrontierWitness`、`StaticDriverCapacityProof@1`、`RunDriverBudgetAdmission@1`、`ContributionClosureReceipt`、`FixtureConclusionPolicyManifest@1`、`FixtureConclusionDecisionSeal@1`
- 没有测试

---

## Scope Boundaries

- **范围内：** 所有 U13.1 合约 schema 定义、Kernel 完整实现、单元测试与集成测试、F9/Kernel 状态标记
- **Deferred for later:** U7 后置 Eval Verdict（属于下一单元）、U8 M1-F9 Demo（属于再下一单元）、U13.2 Published F9（属于再下一单元）、生产验签/wrong-role/nonce replay/key rotation（属于 10620/U13.2）
- **不在范围内：** 连接 U13.2 的 10620 Authority、查询 production active pointer、生成 UseDecision、签发 `AttributionFeasibilityVerdict`、注册 F9 Route、产生 `PublishedAttributionSafetyVerdict`、UI 展示

---

## Key Technical Decisions

- **新合约文件放在已有 `attribution/` 目录**：`derived-delta-observation-set.ts`、`static-driver-capacity-proof.ts`、`run-driver-budget-admission.ts`、`same-frontier-witness.ts`、`contribution-closure-receipt.ts`、`fixture-conclusion-policy-manifest.ts`、`fixture-conclusion-decision-seal.ts`
- **Kernel 重写为 pipeline 模式**：StaticDriverCapacityProof (compile-time) → RunDriverBudgetAdmission (runtime) → EndpointBinding → LoweringCertificate → SameFrontierWitness → QueryEvidence → DerivedDeltaObservationSet → ContributionClosureReceipt → FixtureConclusionPolicyManifest → FixtureConclusionDecisionCandidate → seal to AttributionKernelEvidence
- **Budget 集成使用 contracts 层纯函数**：不依赖 U4 worker 运行时，通过 port/adapter 模式注入预算检查
- **`computed_closure_error` = `decline_amount - sum(contributions)`**：不会把 closure error 当平衡项回填 `independently_observed_residual_delta`
- **`FixtureConclusionPolicyManifest` 只做 typed candidate 检查**：M1 不用 key/nonce/rotation
- **`AttributionKernelEvidence@1` 扩展**：包含完整的 `version_frontier_ref`、`endpoint_binding_refs`、`lowering_certificate_refs`、`budget_admission_ref`、`delta_observation_set_ref`、`closure_receipt_ref`、`conclusion_candidate`、`closure_verdict`、`f9_status` 标记

---

## Implementation Units

### U1. DerivedDeltaObservationSet — 合约 schema

**Goal:** 定义 `DerivedDeltaObservationSet@1` schema，承载每个 outcome/driver/observed-residual 的两窗 level、signed delta、endpoint/evidence ref 与 derivation metadata

**Requirements:** implement.md 8.6 — delta observation set

**Dependencies:** None

**Files:**
- Create: `packages/contracts/src/attribution/derived-delta-observation-set.ts`
- Modify: `packages/contracts/src/attribution/index.ts` (export)

**Approach:**
1. 定义 `derivedDeltaObservationSetSchema`：`protocol_version: "derived-delta-observation-set@1"`，包含 `observation_id`、`subject_id`（outcome/driver/residual）、`baseline_level`、`follow_up_level`、`signed_delta`、`delta_unit`、`endpoint_binding_ref`、`evidence_refs`（baseline + follow-up）、`frontier_witness_ref`、`derivation_metadata`（`computed_at`、`delta_method`、`confidence`）
2. 定义 `deltaObservationKindSchema`：`z.enum(["OUTCOME", "DRIVER", "INDEPENDENTLY_OBSERVED_RESIDUAL"])`
3. 定义 `DeltaObservationSet` 类型（observations 数组 + closure error + unexplained remainder）
4. 导出类型和 schema

**Test scenarios:**
- Happy path: 完整 delta observation set 通过 schema 校验
- Edge case: signed_delta 与 baseline/follow-up 算术不一致
- Edge case: delta_unit 在 baseline/follow-up 之间不一致
- Edge case: observation_kind 枚举值正确

**Verification:**
- `pnpm typecheck` 通过
- `pnpm test:unit` 中新增 schema 校验测试通过

---

### U2. StaticDriverCapacityProof — 合约 schema

**Goal:** 定义 `StaticDriverCapacityProof@1` schema，证明 Profile 在 U6 obligation/DIAGNOSTIC binding/artifact-input 静态上限内可编译

**Requirements:** implement.md 8.6 — compile-time budget proof

**Dependencies:** None

**Files:**
- Create: `packages/contracts/src/attribution/static-driver-capacity-proof.ts`
- Modify: `packages/contracts/src/attribution/index.ts` (export)

**Approach:**
1. 定义 `staticDriverCapacityProofSchema`：`protocol_version: "static-driver-capacity-proof@1"`，包含 `proof_id`、`profile_hash`、`source_release_digest`、`driver_count`、`max_driver_limit`、`sql_estimate`、`max_sql_limit`、`obligation_estimate`、`max_obligation_limit`、`artifact_input_estimate`、`max_artifact_input_limit`、`verdict: "WITHIN_CAPACITY" | "EXCEEDS_CAPACITY"`、`checked_at`、`checker_version`
2. 定义 `MAX_DRIVER_LIMIT=6` 常量（当前 16 SQL 最宽前提下绝对上限）
3. 定义 `MAX_SQL_LIMIT=16` 常量

**Test scenarios:**
- Happy path: 6 个 driver 以内的 profile 通过容量校验
- Edge case: 7 个 driver 返回 EXCEEDS_CAPACITY
- Edge case: sql_estimate 超过 16 返回 EXCEEDS_CAPACITY
- Error path: 空 profile 或 profile_hash 不匹配

**Verification:**
- `pnpm typecheck` 通过
- `pnpm test:unit` 中新增 schema 校验测试通过

---

### U3. RunDriverBudgetAdmission & ContributionClosureReceipt — 合约 schema

**Goal:** 定义 `RunDriverBudgetAdmission@1` 和 `ContributionClosureReceipt@1` schema

**Requirements:** implement.md 8.6 — runtime budget admission + closure receipt

**Dependencies:** U1, U2

**Files:**
- Create: `packages/contracts/src/attribution/run-driver-budget-admission.ts`
- Create: `packages/contracts/src/attribution/contribution-closure-receipt.ts`
- Modify: `packages/contracts/src/attribution/index.ts` (export)

**Approach (RunDriverBudgetAdmission@1):**
1. 定义 `budgetAdmissionStatusSchema`：`z.enum(["RESERVED", "CONSUMED", "RELEASED", "EXPIRED"])`
2. 定义 `runDriverBudgetAdmissionSchema`：`protocol_version: "run-driver-budget-admission@1"`，包含 `admission_id`、`run_fence`、`question_hash`、`profile_hash`、`reservation_id`、`idempotency_key`、`admission_sequence`、`admission_expiry`、`status: BudgetAdmissionStatus`、`remaining_sql_budget`、`remaining_obligation_budget`、`remaining_artifact_input_budget`、`admitted_at`、`consumed_at`/`released_at`/`expired_at`（可选）
3. 定义 `budgetAdmissionReservationSchema` 用于 check-and-reserve 操作

**Approach (ContributionClosureReceipt@1):**
1. 定义 `contributionClosureReceiptSchema`：`protocol_version: "contribution-closure-receipt@1"`，包含 `receipt_id`、`profile_hash`、`truth_contract_hash`、`observations`（delta observation set refs）、`computed_closure_error`、`independently_observed_residual_delta`、`unexplained_remainder`、`closure_verdict: "PASS" | "HOLD" | "REFUSE"`、`closure_verifier`、`closure_verifier_version`、`closed_at`
2. 三字段分离：`computed_closure_error` 不得回填 `independently_observed_residual_delta` 或 `unexplained_remainder`

**Test scenarios:**
- Happy path: 完整 budget admission 通过 schema 校验
- Happy path: 完整 closure receipt 通过 schema 校验
- Edge case: status 转换 RESERVED→CONSUMED 有效，RESERVED→CONSUMED→RELEASED 无效
- Edge case: closure_error 与 observations 算术不一致
- Error path: 余额不足时 admission 拒绝

**Verification:**
- `pnpm typecheck` 通过
- `pnpm test:unit` 中新增 schema 校验测试通过

---

### U4. SameFrontierWitness & EndpointLoweringCertificate 扩展 — 合约 schema

**Goal:** 定义 `SameFrontierWitness@1` schema，扩展已有 `EndpointLoweringCertificate@1` 的完整链路

**Requirements:** implement.md 8.6 — frontier witness + lowering certificate chain

**Dependencies:** U1

**Files:**
- Create: `packages/contracts/src/attribution/same-frontier-witness.ts`
- Modify: `packages/contracts/src/attribution/profile.ts` (扩展 endpointLoweringCertificateSchema)
- Modify: `packages/contracts/src/attribution/index.ts` (export)

**Approach (SameFrontierWitness@1):**
1. 定义 `fiveAxisFrontierSchema`：`z.object({ identity_ref, principal_ref, scope_ref, time_window_ref, classification_ref })`，每个轴是 `{ ref, hash, version }`
2. 定义 `sameFrontierWitnessSchema`：`protocol_version: "same-frontier-witness@1"`，包含 `witness_id`、`baseline_frontier`（五轴）、`follow_up_frontier`（五轴）、`frontier_identity_digest`（证明两端五轴内容一致）、`witnessed_by`、`witnessed_at`、`witness_status: "IDENTICAL" | "CROSS_AXIS_MISMATCH" | "STALE"`

**Approach (EndpointLoweringCertificate 扩展):**
1. 在 `endpointLoweringCertificateSchema` 中新增 `canonical_ast_hash`、`query_contract_hash`、`grounding_package_hash`、`logical_plan_hash`、`sql_artifact_hash`、`parameter_hash`、`evidence_hash` 字段
2. 新增 `lowering_chain: z.array(z.object({ step: z.string(), input_hash, output_hash }))` 记录逐节点 lowering 链路

**Test scenarios:**
- Happy path: 五轴完全一致时 frontier witness 通过
- Edge case: 跨轴拼接（baseline identity 配 follow-up principal）被拒绝
- Edge case: 五轴中任一轴 hash 不匹配
- Happy path: 完整 lowering certificate chain 通过 schema 校验
- Edge case: canonical_ast_hash 与 sql_artifact_hash 不一致

**Verification:**
- `pnpm typecheck` 通过
- `pnpm test:unit` 中新增 schema 校验测试通过

---

### U5. FixtureConclusionPolicyManifest & FixtureConclusionDecisionSeal — 合约 schema

**Goal:** 定义 M1 范围的 `FixtureConclusionPolicyManifest@1` 和 `FixtureConclusionDecisionSeal@1` schema

**Requirements:** implement.md 8.6 — fixture conclusion policy + decision seal

**Dependencies:** U1, U4

**Files:**
- Create: `packages/contracts/src/attribution/fixture-conclusion-policy-manifest.ts`
- Create: `packages/contracts/src/attribution/fixture-conclusion-decision-seal.ts`
- Modify: `packages/contracts/src/attribution/index.ts` (export)

**Approach (FixtureConclusionPolicyManifest@1):**
1. 定义 `fixtureConclusionPolicyManifestSchema`：`protocol_version: "fixture-conclusion-policy-manifest@1"`，包含 `manifest_id`、`manifest_version`、`fixture_hash`、`profile_hash`、`truth_contract_hash`、`allowed_assertion_types: z.array(z.enum(["ASSERT.claim_ast", "ABSTAIN", "REFUSE"]))`、`policy_hash`（manifest 自身 content-addressed hash）、`checked_in_at`、`checker_version`
2. 只有 `ASSERT.claim_ast` 能确定性生成 Fixture 断言；ABSTAIN/REFUSE 不携带可渲染 ClaimAST
3. 自由 LLM prose、引文、retrieved text、table/code 只能标为 non-authoritative commentary

**Approach (FixtureConclusionDecisionSeal@1):**
1. 定义 `fixtureConclusionDecisionSealSchema`：`protocol_version: "fixture-conclusion-decision-seal@1"`，包含 `seal_id`、`manifest_hash`、`candidate_hash`、`conclusion_verdict`、`decision_status: "SEALED" | "TAMPERED" | "MISMATCH"`、`sealed_by`（只含 checker version，不含 key/nonce）、`sealed_at`、`seal_hash`（content-addressed）
2. M1 范围：不含 key/nonce/rotation，不是 bearer/产品授权

**Test scenarios:**
- Happy path: 完整 policy manifest 通过 schema 校验
- Happy path: 合法 candidate 被 seal 为 SEALED
- Edge case: manifest/candidate/seal 内容被篡改导致 TAMPERED
- Edge case: checker abstention（ABSTAIN）不携带 ClaimAST
- Error path: 试图在 manifest 中使用非 ASSERT.claim_ast 类型生成断言

**Verification:**
- `pnpm typecheck` 通过
- `pnpm test:unit` 中新增 schema 校验测试通过

---

### U6. AttributionKernelEvidence 扩展 — 合约 schema

**Goal:** 扩展 `AttributionKernelEvidence@1` schema，包含完整的 U13.1 输出结构

**Requirements:** implement.md 8.6 — kernel evidence with fixed status markings

**Dependencies:** U1, U2, U3, U4, U5

**Files:**
- Modify: `packages/contracts/src/attribution/evidence.ts` (扩展 schema)
- Modify: `packages/contracts/src/attribution/index.ts` (export)

**Approach:**
1. 扩展 `attributionKernelEvidenceSchema` 新增：
   - `kernel_version: "attribution-kernel@1"`
   - `version_frontier_refs`（baseline + follow-up 的五轴 refs）
   - `endpoint_binding_refs`（每个 endpoint 的 binding ref）
   - `lowering_certificate_refs`（每个 endpoint 的 lowering certificate ref）
   - `budget_admission_ref`（run budget admission ref）
   - `delta_observation_set_ref`（derived delta observation set ref）
   - `closure_receipt_ref`（contribution closure receipt ref）
   - `conclusion_candidate`（FixtureConclusionCandidate）
   - `closure_verdict: "PASS" | "HOLD" | "REFUSE"`
   - `explicit_absence`（固定 `"attribution_feasibility_verdict"`）
   - `f9_status: object`（`core_l2: "HOLD"`, `attribution_f9: "NOT_REGISTERED"`, `fixture_evidence: "HOLD"`）
2. 保留现有 `evidence_id`、`app_id`、`tenant_id`、`environment`、`run_id`、`origin`、`profile_hash`、`contribution_truth_hash`、`fixture_conclusion`、`sealed_at`

**Test scenarios:**
- Happy path: 完整扩展后的 evidence 通过 schema 校验
- Edge case: f9_status 中 core_l2 不是 HOLD 时拒绝
- Edge case: explicit_absence 不是固定值时拒绝
- Edge case: closure_verdict 与 fixture_conclusion 状态一致
- Error path: 缺少 delta_observation_set_ref 时拒绝

**Verification:**
- `pnpm typecheck` 通过
- `pnpm test:unit` 中新增 schema 校验测试通过

---

### U7. Fixture Endpoint Kernel — Pipeline 实现

**Goal:** 重写 `kernel.ts` 为完整的 U13.1 pipeline，实现从 hash-pinned 输入到 sealed AttributionKernelEvidence 的完整流程

**Requirements:** implement.md 8.6 — 全部 kernel 逻辑

**Dependencies:** U1, U2, U3, U4, U5, U6

**Files:**
- Modify: `packages/research/src/attribution-fixture/kernel.ts` (重写)
- Modify: `packages/research/src/attribution-fixture/index.ts` (导出)
- Modify: `packages/research/src/index.ts` (导出)

**Approach:**
Pipeline 步骤（顺序固定）：

1. **StaticDriverCapacityProof** — 编译期检查 profile driver count ≤ 6, sql estimate ≤ 16
   - 输入：profile_hash, source_release_digest, driver_count, sql_estimate
   - 输出：capacity_proof（WITHIN_CAPACITY / EXCEEDS_CAPACITY）
   - 失败：返回 `CONTRIBUTION_DRIVER_BUDGET_EXCEEDED` typed refusal

2. **RunDriverBudgetAdmission** — 运行时检查当前 Run 剩余预算
   - 输入：run_fence, question_hash, profile_hash, remaining_sql_budget, remaining_obligation_budget
   - 输出：budget_admission（RESERVED / REJECTED）
   - 失败：返回 `CONTRIBUTION_DRIVER_BUDGET_EXCEEDED` typed refusal

3. **Endpoint Execution Binding** — 将静态 template 实例化为运行时 binding
   - 输入：profile endpoints, truth contract patterns
   - 输出：`EndpointExecutionBinding[]`（每个 endpoint 的 binding）
   - 每个 binding 携带 exact 五轴 VersionFrontier ref/hash

4. **SameFrontierWitness Verification** — 检查 baseline/follow-up 五轴一致性
   - 输入：baseline_frontier, follow_up_frontier
   - 输出：witness（IDENTICAL / CROSS_AXIS_MISMATCH / STALE）
   - 失败：配置 mismatch 为 HOLD

5. **EndpointLoweringCertificate Verification** — 逐端验证 lowering 链路
   - 输入：endpoint, lowering_rule_set, canonical_ast → query_contract → logical_plan → sql_artifact → evidence
   - 输出：`EndpointLoweringCertificate[]`
   - 失败：配置为 HOLD

6. **DerivedDeltaObservationSet Computation** — 从 baseline/follow-up QueryEvidence 计算 delta
   - 输入：baseline_evidence, follow_up_evidence
   - 输出：`DerivedDeltaObservationSet@1`（每个 outcome/driver/residual 的 level + delta）
   - computed_closure_error = decline_amount - sum(contributions)
   - independently_observed_residual_delta = 独立残留观测
   - unexplained_remainder = closure_error - observed_residual_delta

7. **ContributionClosureReceipt Generation** — 生成 closure receipt
   - 输入：observations, computed_closure_error, independently_observed_residual_delta, unexplained_remainder
   - 输出：`ContributionClosureReceipt@1`（含 closure_verdict）

8. **FixtureConclusionPolicyManifest Check** — 检查 typed candidate 合法性
   - 输入：checked-in manifest, candidate
   - 只允许 `ASSERT.claim_ast` 生成断言；ABSTAIN/REFUSE 不携带 ClaimAST
   - 输出：manifest check result

9. **FixtureConclusionCandidate Generation** — 生成 conclusion candidate
   - 输入：所有前面步骤的输出
   - 输出：`FixtureConclusionCandidate@1`（typed）

10. **Seal to AttributionKernelEvidence** — 密封为不可变证据
    - 输入：candidate + 所有 refs/hashes
    - 输出：`AttributionKernelEvidence@1`（内容寻址、deepFreeze）
    - 固定 status：Core L2=`HOLD`, Attribution F9=`NOT_REGISTERED`, Fixture Evidence=`HOLD`

**Key types to define:**

```typescript
export interface AttributionFixtureKernelInput {
  readonly profile: AttributionProfileProjection;
  readonly profile_hash: `sha256:${string}`;
  readonly truth_contract: ContributionTruthContract;
  readonly truth_contract_hash: `sha256:${string}`;
  readonly run_fence: string;
  readonly question_hash: `sha256:${string}`;
  readonly remaining_sql_budget: number;
  readonly remaining_obligation_budget: number;
  readonly remaining_artifact_input_budget: number;
}

export type FixtureKernelStepResult<T> =
  | { readonly ok: true; readonly value: T; readonly step: string }
  | { readonly ok: false; readonly error: TypedFixtureKernelError; readonly step: string };

export interface TypedFixtureKernelError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly refusal: "CONTRIBUTION_DRIVER_BUDGET_EXCEEDED" | "FRONTIER_MISMATCH" | "LOWERING_FAILED" | "MANIFEST_TAMPERED" | "INTERNAL_ERROR" | null;
}

export function runAttributionFixtureKernel(
  input: AttributionFixtureKernelInput,
): FixtureKernelStepResult<AttributionKernelEvidence>;
```

**Patterns to follow:**
- 现有 `research/src/evidence.ts` 中 `evaluateObligationExecution`、`deriveSupportDecision` 的纯函数 reducer 模式
- `researchKernelSuccess` / `researchKernelFailure` 的 Result 类型模式
- `deepFreeze` 用于不可变输出

**Execution note:** 单元优先，先写 contracts 再写 kernel 逻辑，kernel 逻辑先写 pipeline 框架再填充每个步骤

**Test scenarios:**
- Happy path: 完整 pipeline 从合法输入到 sealed evidence
- Happy path: 6 个 driver 以内通过 capacity check
- Edge case: 7 个 driver 返回 CONTRIBUTION_DRIVER_BUDGET_EXCEEDED
- Edge case: 五轴 mismatch 返回 HOLD
- Edge case: lowering certificate 缺失返回 HOLD
- Edge case: manifest tampered 返回 TAMPERED
- Edge case: checker abstention 不携带 ClaimAST
- Error path: profile 不是 FIXTURE 返回错误
- Error path: truth_contract_hash 不匹配返回错误
- Error path: 运行时预算不足返回 CONTRIBUTION_DRIVER_BUDGET_EXCEEDED
- Integration: 输出 evidence 的 f9_status 固定为 HOLD/NOT_REGISTERED/HOLD
- Integration: computed_closure_error 不回填 observed_residual_delta

**Verification:**
- `pnpm typecheck` 通过
- `pnpm test:unit` 中 attribution-fixture kernel 测试全部通过
- 输出证据的 closure_verdict, f9_status 字段值正确

---

### U8. Budget Integration — 准入与生命周期

**Goal:** 实现 budget admission 的 check-and-reserve、consume、release、expire 生命周期，以及与 U4 lease/fence 的集成

**Requirements:** implement.md 8.6 — budget lifecycle with crash recovery

**Dependencies:** U3, U7

**Files:**
- Create: `packages/research/src/attribution-fixture/budget-integration.ts`
- Modify: `packages/research/src/attribution-fixture/index.ts` (导出)
- Create: `packages/research/test/attribution-fixture-budget.spec.ts`

**Approach:**
1. 实现 `checkAndReserveBudget`：绑定 run_fence、question_hash、profile_hash、reservation_id、idempotency_key、sequence/expiry
2. 实现 `consumeBudget`：RESERVED → CONSUMED
3. 实现 `releaseBudget`：RESERVED → RELEASED
4. 实现 `expireBudget`：RESERVED → EXPIRED（超时自动释放）
5. 同 fence retry 幂等：相同 idempotency_key 返回已有 reservation
6. crash-before-consume：可恢复/过期释放
7. crash-after-consume：保持计费
8. 新 fence 重新准入，不得双扣或遗留永久 reservation
9. 当前整个 Run 可用 16 SQL 且每 endpoint 一条 SQL 时绝对上限为 6 drivers
10. 实际预算更小时继续收紧，超限返回 `CONTRIBUTION_DRIVER_BUDGET_EXCEEDED`

**Patterns to follow:**
- 现有 `research/src/input-budget.ts` 的 budget 检查模式
- U4 lease/fence 模式

**Test scenarios:**
- Happy path: reserve → consume 完整生命周期
- Happy path: 同 fence 幂等 retry 返回相同 reservation
- Edge case: crash-before-consume 可恢复/过期释放
- Edge case: crash-after-consume 保持计费，不重复扣减
- Edge case: 新 fence 重新准入
- Edge case: budget 不足时拒绝
- Error path: 重复扣减被拒绝
- Error path: 过期 reservation 被释放

**Verification:**
- `pnpm typecheck` 通过
- `pnpm test:unit` 中 budget integration 测试全部通过

---

### U9. Fixture Conclusion Policy — Manifest 检查器

**Goal:** 实现 `FixtureConclusionPolicyManifest` 的 typed candidate 检查逻辑

**Requirements:** implement.md 8.6 — manifest checker with claim_ast only

**Dependencies:** U5, U7

**Files:**
- Create: `packages/research/src/attribution-fixture/manifest-checker.ts`
- Modify: `packages/research/src/attribution-fixture/index.ts` (导出)
- Create: `packages/research/test/attribution-fixture-manifest-checker.spec.ts`

**Approach:**
1. 实现 `checkConclusionCandidate`：验证 candidate 与 manifest 一致性
2. 只允许 `ASSERT.claim_ast` 生成确定性断言
3. ABSTAIN/REFUSE 不携带可渲染 ClaimAST
4. 自由 LLM prose、引文、retrieved text、table/code 只能标为 non-authoritative commentary
5. tamper 检测：manifest hash、candidate hash、seal hash 不一致 → TAMPERED
6. mismatch 检测：candidate 类型与 manifest 允许的 assertion_types 不匹配 → MISMATCH
7. checker abstention：ABSTAIN 时不生成 ClaimAST

**Test scenarios:**
- Happy path: ASSERT.claim_ast candidate 通过检查
- Happy path: ABSTAIN 不携带 ClaimAST
- Edge case: manifest hash 被篡改 → TAMPERED
- Edge case: candidate hash 与 seal 不匹配 → MISMATCH
- Edge case: REFUSE 不携带 ClaimAST
- Error path: 试图在 ABSTAIN candidate 中携带 ClaimAST 被拒绝

**Verification:**
- `pnpm typecheck` 通过
- `pnpm test:unit` 中 manifest checker 测试全部通过

---

### U10. Full Pipeline Integration — 端到端测试

**Goal:** 构建完整的 U13.1 pipeline 端到端集成测试，验证从输入到 sealed evidence 的完整链路

**Requirements:** implement.md 8.6 — 全部验收条件

**Dependencies:** U7, U8, U9

**Files:**
- Create: `packages/research/test/attribution-fixture-integration.spec.ts`

**Approach:**
1. 构建合法的 Fixture profile（retail-revenue-contribution-v1 数据集）
2. 构建合法的 ContributionTruthContract（包含 promotion 和 late-refund 两个 pattern）
3. 构建合法的 budget 状态
4. 运行完整 pipeline
5. 验证输出：
   - `AttributionKernelEvidence` sealed 且不可变（deepFreeze）
   - `closure_verdict` = PASS
   - `f9_status.core_l2` = "HOLD"
   - `f9_status.attribution_f9` = "NOT_REGISTERED"
   - `f9_status.fixture_evidence` = "HOLD"
   - `explicit_absence` = "attribution_feasibility_verdict"
   - `computed_closure_error` 与 `independently_observed_residual_delta` 分离
   - 所有 refs 完整且内容寻址

**Test scenarios:**
- Happy path: 完整端到端 pipeline 通过
- Edge case: 超预算时返回 typed refusal
- Edge case: 五轴 mismatch 时 closure_verdict = HOLD
- Edge case: 输出不可变（deepFreeze 验证）
- Error path: 非法 profile 输入被拒绝

**Verification:**
- `pnpm test:unit` 中 attribution-fixture-integration 测试全部通过
- `pnpm typecheck` 通过

---

## System-Wide Impact

- **Contracts 包**: `packages/contracts/src/attribution/` 新增 7 个文件，扩展 1 个文件（evidence.ts），修改 1 个文件（profile.ts），更新 index.ts 导出
- **Research 包**: `packages/research/src/attribution-fixture/` 重写 kernel.ts，新增 budget-integration.ts、manifest-checker.ts，更新 index.ts 导出
- **F9 状态**: U13.1 输出始终携带 `KERNEL_CANDIDATE_ONLY/HOLD`，不注册 F9，不产生安全结论
- **无 API 变更**: U13.1 是纯内核模块，不涉及 API 路由、数据库 schema 或前端 UI 变更
- **无外部依赖新增**: 所有新增代码只依赖 `@data-agent/contracts` 和标准 TypeScript 类型

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| U13.1 与 U5/U6 QueryEvidence 链的集成复杂度 | 使用纯函数接口 + port/adapter 模式；kernel 不直接依赖 U5/U6 数据库实现 |
| Budget 生命周期与 U4 lease/fence 的集成 | budget-integration 模块使用纯函数 + 状态机，不直接依赖 U4 运行时 |
| computed_closure_error 与 observed_residual_delta 的分离逻辑 | 三字段分离是 schema 级别的强制约束，kernel 不把 closure_error 当平衡项回填 |
| M1 范围的 key/nonce/rotation 限制 | FixtureConclusionDecisionSeal 显式标注不含 key/nonce，且只用于 M1 |
| 现有 kernel.ts 的向后兼容 | 完全重写现有 kernel.ts，但导出接口保持兼容或扩展 |

---

## Sources & References

- **Origin document:** `.trellis/tasks/07-25-data-agent-reset-refactor/implement.md` (Section 8.6)
- **Existing contracts:** `packages/contracts/src/attribution/`
- **Existing kernel stub:** `packages/research/src/attribution-fixture/kernel.ts`
- **Existing test patterns:** `packages/research/test/evidence.spec.ts`, `packages/research/test/fixtures.ts`
- **Related:** `packages/contracts/src/attribution/truth-contract.ts`, `profile.ts`, `evidence.ts`, `conclusion.ts`, `conclusion-policy.ts`
