---
title: "U7 Published Governance Delta 实施计划"
type: plan
date: 2026-08-04
origin: docs/brainstorms/2026-08-04-u7-published-governance-delta-requirements.md
status: active
---

# U7 Published Governance Delta 实施计划

## Summary

在 U7 Eval 基础框架上新增 `governance` Benchmark Suite（第 5 套），为 U11 已交付的语义治理服务提供质量评估能力。同时分离 Eval 泳道类型、新增四种治理 Truth 类型、创建治理适配器和 Eval Case，并更新 `eval:smoke` 门禁。

---

## Problem Frame

U11 语义治理服务已完成交付，但没有任何评测覆盖其质量。现有 4 个 Suite 混在同一评分维度下，缺少对治理流程（审核、发布、回滚、权限分离）的自动化评估。implement.md 8.10 明确要求 U7 Published Delta 补偿治理评测案例，并分离 Grounding、End-to-End Product、Authorization、Contribution 泳道。

---

## Scope Boundaries

- **范围内：** Schema 扩展（governance Suite + Lane 类型）、Truth 类型定义、Governance Adapter 接口与实现、治理 Eval Case 清单、`eval:smoke` 门禁更新
- **Deferred for later:** 治理适配器的真实数据库接入（当前使用 Mock 数据模式，与现有 4 个 Adapter 一致）
- **不在范围内：** U11 治理服务本身的增强、F9 归因 published-governance（U13.2+）、U13.0/U13.1 工作、前端 UI 变更、API 路由变更、数据库 schema 变更

---

## Key Technical Decisions

- **新增 `"governance"` 作为第 5 个 Suite 枚举值**：而非在现有 Suite 中嵌入治理检查。独立 Suite 保持架构一致性，且允许治理评估拥有独立的 oracle 类型和评分标准。
- **四种 Truth 类型作为独立类型定义**：每种类型有自己的 Zod schema 和验证逻辑，提供更好的类型安全性和可扩展性。
- **Lane 分离通过 `LANE_BY_SUITE` 常量映射实现**：零运行时开销的编译时绑定，Suite 和 Lane 的对应关系是固定的设计决策，不需要运行时动态关联。
- **治理适配器遵循现有 Adapter 模式**：`run()` 和 `oracle()` 方法，Mock 数据，随机 UUID（与 `insightbench-adapter.ts`、`controlled-attribution-adapter.ts` 一致）。

---

## Implementation Units

### U1. Governance Suite — Schema 扩展

**Goal:** 在 contracts 包的 eval schema 中新增 `"governance"` 枚举值、对应的 oracle 变体，以及 Lane 类型定义

**Requirements:** R1, R2, R3, R4, R12, R13, R14, R15

**Dependencies:** None

**Files:**
- Modify: `packages/contracts/src/evals/schemas.ts`
- Modify: `packages/contracts/src/evals/index.ts`

**Approach:**
1. 在 `benchmarkSuiteSchema` 的 `z.enum([...])` 中新增 `"governance"` 值
2. 在 `benchmarkOracleSchema` 的 `z.discriminatedUnion("suite", [...])` 中新增 `governance` 变体：`oracle_type: "GOVERNANCE_SERVICE_QUALITY"`，`expected` 为字符串数组
3. 在 `ORACLE_TYPE_BY_SUITE` 映射中新增 `"governance": "GOVERNANCE_SERVICE_QUALITY"`
4. 在 `oracleVerdictReceiptSchema` 的 discriminated union 中新增 `governance` 变体
5. 定义 `EvalLane` 类型 (`"grounding" | "end-to-end-product" | "authorization" | "contribution"`)
6. 定义 `LANE_BY_SUITE` 常量映射（5 个 Suite 到各自 Lane 的绑定）
7. 更新 `evalCaseSchema` 的 suite/oracle 一致性校验（superRefine 中的 suite 匹配逻辑不需要改，因为 discriminated union 自动处理）
8. 导出 `EvalLane`、`LANE_BY_SUITE` 类型和常量

**Patterns to follow:**
- 现有 `benchmarkOracleSchema` 中 `insightbench`、`dab`、`rcaeval`、`controlled-attribution` 的 discriminated union 模式
- `ORACLE_TYPE_BY_SUITE` 的常量映射模式

**Test scenarios:**
- Happy path: governance Suite 的 EvalCase 创建通过 schema 校验，oracle_type 与 suite 匹配
- Edge case: 非 governance Suite 的 EvalCase 误用 `GOVERNANCE_SERVICE_QUALITY` oracle_type 被类型系统拒绝
- Edge case: 所有 5 个 Suite 的 Lane 映射完整且无重复
- Integration: `pnpm typecheck` 通过

**Verification:**
- `benchmarkSuiteSchema.options` 包含 5 个值（含 `"governance"`）
- `LANE_BY_SUITE` 包含全部 5 个 Suite 的映射
- 类型导出在 `packages/contracts/src/evals/index.ts` 中可用

---

### U2. Governance Truth 类型定义

**Goal:** 在 contracts 包中新增四种治理 Truth 类型定义

**Requirements:** R7, R8, R9

**Dependencies:** U1

**Files:**
- Create: `packages/contracts/src/evals/truth-types.ts`
- Modify: `packages/contracts/src/evals/index.ts`

**Approach:**
1. 创建 `truth-types.ts`，使用 Zod strictObject 定义四种 Truth 类型：
   - `ArithmeticPartitionTruth`：包含 `partition_id`、`partition_value`、`expected_share`、`actual_share`、`tolerance` 等字段
   - `InjectedFaultTruth`：包含 `fault_id`、`fault_type`、`injected_at`、`detected`、`detection_latency_ms` 等字段
   - `ExpertInvestigationPriorityLabel`：包含 `case_id`、`expert_label`、`system_label`、`agreement`、`confidence` 等字段
   - `SCMCausalTruth`：包含 `model_id`、`cause_variable`、`effect_variable`、`estimated_effect`、`confidence_interval`、`p_value` 等字段
2. 为每种 Truth 类型导出 TypeScript 类型
3. 在 `index.ts` 中重新导出所有 Truth 类型

**Patterns to follow:**
- 现有 `packages/contracts/src/evals/schemas.ts` 中的 Zod 严格模式模式
- `z.strictObject({...})` 确保多余字段被拒绝

**Test scenarios:**
- Happy path: 每种 Truth 类型的有效数据通过 schema 校验
- Edge case: 多余字段被 `strictObject` 拒绝
- Edge case: 缺少必填字段被 schema 拒绝
- Integration: 类型从 `packages/contracts/src/evals/index.ts` 正确导出

**Verification:**
- 四种 Truth 类型全部定义并导出
- `pnpm typecheck` 通过

---

### U3. Governance Adapter 接口与实现

**Goal:** 在 evals 包中新增 `GovernanceAdapter` 接口和 `governance-adapter.ts` 实现

**Requirements:** R5, R6

**Dependencies:** U1

**Files:**
- Modify: `packages/evals/src/index.ts`
- Create: `packages/evals/src/governance-adapter.ts`

**Approach:**
1. 在 `packages/evals/src/index.ts` 中新增 `GovernanceAdapter` 接口（继承 `EvalAdapter`，固定 `suite: "governance"`、`oracle_type: "GOVERNANCE_SERVICE_QUALITY"`）
2. 创建 `governance-adapter.ts`，实现 `GovernanceAdapter`：
   - `run()` 方法：评估 U11 治理服务的四个维度
     - 候选摘要质量（Candidate Summary Quality）
     - 审核决策一致性（Review Decision Consistency）
     - 发布/回滚流程正确性（Publish/Rollback Correctness）
     - 领域覆盖完整性（Domain Coverage Completeness）
   - `oracle()` 方法：返回 `GOVERNANCE_SERVICE_QUALITY` 类型的 Oracle Verdict Receipt
   - 使用 Mock 数据模式（与现有 Adapter 一致）
3. 在 `packages/evals/src/index.ts` 中导出 `GovernanceAdapter` 接口和 `GovernanceAdapter` 类

**Patterns to follow:**
- `insightbench-adapter.ts` 的类结构：`readonly suite`、`readonly suite_version`、`readonly oracle_type`、`run()` 方法、`oracle()` 方法
- `EvalAdapter` 接口的契约：`EvalAdapterResult` 包含 `scoreCard`、`oracleReceipt`、`evalRun`

**Test scenarios:**
- Happy path: GovernanceAdapter 的 `run()` 返回完整的 `EvalAdapterResult`
- Happy path: GovernanceAdapter 的 `oracle()` 返回正确的 `GOVERNANCE_SERVICE_QUALITY` Receipt
- Edge case: Adapter 的 suite 固定为 `"governance"`，不能被覆盖
- Edge case: EvalAdapter 的其他 Suite 实现不能误用 GovernanceAdapter 的类型
- Integration: GovernanceAdapter 可通过 `EvalRunner` 的 `runSingle()` 调用

**Verification:**
- `governance-adapter.ts` 文件存在
- `pnpm typecheck` 通过
- 遵循现有 Adapter 接口模式

---

### U4. Governance Eval Case 清单

**Goal:** 在 contracts 包的 manifest 中新增三个治理评测案例

**Requirements:** R10, R11

**Dependencies:** U1, U2

**Files:**
- Modify: `packages/contracts/src/evals/manifest.ts`
- Modify: `packages/contracts/src/evals/index.ts`

**Approach:**
1. 在 `manifest.ts` 中新增三个 governance 评测案例：
   - `governance-semantic-review-v1`：治理审核流程测试
     - Oracle 预期：验证候选提交→审核→决策→发布→回滚全流程的治理质量
     - 包含 4 个 Mutation：审核决策一致性、角色权限分离、发布/回滚流程、审核超时处理
   - `governance-domain-coverage-v1`：领域覆盖完整性测试
     - Oracle 预期：验证治理系统对多个语义领域的覆盖完整性
     - 包含 3 个 Mutation：多领域覆盖、领域边界隔离、新领域注册
   - `governance-role-permission-v1`：角色权限分离测试
     - Oracle 预期：验证 proposer/reviewer/admin/publisher 四类角色的权限隔离
     - 包含 4 个 Mutation：proposer 越权、reviewer 越权、admin 越权、publisher 权限
2. 每个案例的 oracle 类型为 `GOVERNANCE_SERVICE_QUALITY`，suite 为 `"governance"`
3. 导出三个案例的创建函数

**Patterns to follow:**
- `createRetailRevenueInvestigationV1Case()` 的案例创建模式
- `RETAIL_REVENUE_INVESTIGATION_V1_MUTATIONS` 的 Mutation 定义模式
- `benchmarkBudgetSchema` 和 `benchmarkDemoHoldoutIdentitySchema` 的配置模式

**Test scenarios:**
- Happy path: 每个 governance 案例的 `create*Case()` 返回有效的 EvalCase
- Happy path: 每个案例的 suite 为 `"governance"`，oracle_type 为 `"GOVERNANCE_SERVICE_QUALITY"`
- Edge case: 所有案例的 case_hash 不是占位符
- Edge case: 不同类型（review/domain/role）的 Mutation 配置正确

**Verification:**
- 三个治理案例全部定义并导出
- `pnpm typecheck` 通过

---

### U5. eval:smoke 门禁更新

**Goal:** 更新 `eval:smoke` 脚本，新增 governance 适配器检测和治理相关条件

**Requirements:** R16, R17, R18, R19

**Dependencies:** U3, U4

**Files:**
- Modify: `scripts/eval-smoke.ts`

**Approach:**
1. 在 `detectImplementedUnits()` 中新增：
   - `"U7-adapter-governance"`：检测 `governance-adapter.ts` 是否存在
   - `"U7-truth-contract-governance"`：检测 `truth-types.ts` 是否存在
   - `"U7-governance-eval-case"`：检测治理案例是否在 manifest 中定义
2. 在 conditions 数组中新增 `"governance-adapter-v1"` 条件
3. 在 failure taxonomy 生成逻辑中新增 `"GOVERNANCE_ADAPTER_NOT_IMPLEMENTED"` 故障代码
4. 更新 `allAdapterImplemented` 判断逻辑，包含 governance：
   ```typescript
   const allAdapterImplemented = ["insightbench", "dab", "rcaeval", "controlled-attribution", "governance"].every(...)
   ```
5. 更新 `coreReady` 判断逻辑，包含 governance 相关单元

**Patterns to follow:**
- 现有 `eval-smoke.ts` 中 `U7-adapter-insightbench`、`U7-adapter-dab` 等的检测模式
- `failureTaxonomy.push()` 的故障代码生成模式

**Test scenarios:**
- Happy path: 当 governance 适配器存在时，检测结果显示 `U7-adapter-governance` 已实现
- Happy path: 当所有 5 个 Adapter 都存在时，`allAdapterImplemented` 为 true
- Edge case: 当 governance 适配器缺失时，`GOVERNANCE_ADAPTER_NOT_IMPLEMENTED` 出现在 failure taxonomy 中
- Integration: 脚本运行不报错

**Verification:**
- `eval:smoke` 正确检测 governance 适配器状态
- 治理条件在决策输出中可见

---

## System-Wide Impact

- **Contracts 包影响：** `benchmarkSuiteSchema` 的枚举值增加会影响所有使用 `BenchmarkSuite` 类型的位置——`EvalCase`、`EvalRun`、`ScoreCard`、`OracleVerdictReceipt`、`EvalReleaseDecision`。这些类型都通过 discriminated union 与 suite 绑定，新增 `"governance"` 值后需要对应更新所有 discriminated union 的变体。
- **Evals 包影响：** `EvalAdapter` 接口族新增 `GovernanceAdapter` 子接口。`EvalRunner` 不需要修改，因为它通过 `EvalAdapter` 基接口多态调用。
- **eval:smoke 门禁影响：** 治理检测加入后，`allAdapterImplemented` 的判断条件变为 5 个 Adapter 全部实现。如果 governance adapter 未实现，`coreReady` 为 false，`eval:smoke` 返回 HOLD。
- **未变更的 API 表面：** 前端 API 客户端、API 路由、前端组件、Zustand store、数据库 migration 均不涉及。
- **未变更的不可变声明：** 现有 4 个 Suite 的评分逻辑、Oracle 类型、Truth 类型均不受影响。Lane 分离是只读的编译时映射，不改变运行时行为。

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `benchmarkSuiteSchema` 枚举值变更导致 discriminated union 中缺失变体 | 所有 discriminated union（`benchmarkOracleSchema`、`oracleVerdictReceiptSchema`）同步更新，typecheck 会捕获遗漏 |
| 治理 Truth 类型与实际治理服务的数据结构不匹配 | Truth 类型是基于 implement.md 8.10 的设计决策，后续可调整字段 |
| `eval:smoke` 新增 governance 条件后产出 HOLD | 预期行为——治理适配器完成后恢复正常 |
| U11 治理服务的接口变更导致适配器评估维度不准确 | 治理适配器使用 Mock 数据，不依赖实际治理服务接口，后续可调整评估维度 |

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-08-04-u7-published-governance-delta-requirements.md`
- **Master plan:** `.trellis/tasks/07-25-data-agent-reset-refactor/implement.md` (Section 8.10)
- **相关代码:** `packages/evals/src/insightbench-adapter.ts` (Adapter 模式参考)
- **相关代码:** `packages/evals/src/controlled-attribution-adapter.ts` (Adapter 模式参考)
- **相关代码:** `packages/contracts/src/evals/schemas.ts` (Schema 定义参考)
- **相关代码:** `packages/contracts/src/evals/manifest.ts` (Eval Case 定义参考)
- **相关代码:** `scripts/eval-smoke.ts` (门禁脚本参考)
