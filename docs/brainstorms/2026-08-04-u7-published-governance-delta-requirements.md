---
title: "U7 Published Governance Delta 需求文档"
type: requirements
date: 2026-08-04
origin: .trellis/tasks/07-25-data-agent-reset-refactor/implement.md
language: zh-CN
status: draft
---

# U7 Published Governance Delta

## Summary

在 U7 Eval 基础框架（insightbench、dab、rcaeval、controlled-attribution 四套 Suite）上新增 governance 评测 Suite，为 U11 已交付的语义治理服务（Semantic Governance Service）提供质量评估能力，并分离 Eval 泳道（Grounding、End-to-End Product、Authorization、Contribution）以支持独立存储与评分。

---

## Problem Frame

U11 已在 U10.3 之后交付了完整的语义治理服务——包括 PostgreSQL 服务层、API 路由、UI 组件和 Zustand store。但治理服务的质量目前没有被任何评测覆盖：

- `eval:smoke` 只检查 4 个 Suite 的实现状态，不包含治理相关检查
- 治理服务的 Review/Propose/Approve/Publish/Rollback 流程缺少自动化评估
- 随着治理数据（候选、审核、发布）的积累，需要门禁机制防止治理退化

同时，现有的 4 个 Suite 全都混在同一个评分维度下，没有区分 Grounding 质量、端到端产品质量、授权正确性和贡献归因质量。implement.md 8.10 明确要求分离这些泳道。

这个 delta 不涉及治理服务本身的增强（U11 已完结），也不涉及 F9 归因的 published-governance（那是 U13.2+ 的事）。

---

## Requirements

### Governance Suite 定义

- R1. 在 `benchmarkSuiteSchema` 中新增 `"governance"` 枚举值，作为第 5 个 Benchmark Suite。
- R2. 在 `benchmarkOracleSchema` 中新增 `governance` 对应的 discriminated union 变体：`oracle_type: "GOVERNANCE_SERVICE_QUALITY"`，`expected` 为字符串数组。
- R3. 在 `ORACLE_TYPE_BY_SUITE` 映射中新增 `"governance"` → `"GOVERNANCE_SERVICE_QUALITY"`。
- R4. 在 `oracleVerdictReceiptSchema` 的 discriminated union 中新增 `governance` 变体。
- R5. 在 `EvalAdapter` 接口族中新增 `GovernanceAdapter` 接口，继承 `EvalAdapter`，固定 `suite: "governance"`、`oracle_type: "GOVERNANCE_SERVICE_QUALITY"`。
- R6. 创建 `packages/evals/src/governance-adapter.ts`，实现 `GovernanceAdapter`，评估 U11 语义治理服务的以下维度：
  - 候选摘要质量（Candidate Summary Quality）
  - 审核决策一致性（Review Decision Consistency）
  - 发布/回滚流程正确性（Publish/Rollback Correctness）
  - 领域覆盖完整性（Domain Coverage Completeness）

### 治理 Truth 类型

- R7. 在 `packages/contracts/src/evals/` 中新增治理 Truth 类型定义，包含以下四种：
  - `ArithmeticPartitionTruth`：算数分割真值，验证贡献计算中数值分割的准确性
  - `InjectedFaultTruth`：注入故障真值，验证治理对注入异常的检测能力
  - `ExpertInvestigationPriorityLabel`：专家调查优先级标签，验证治理排序与专家判断的一致性
  - `SCMCausalTruth`：SCM 因果真值，验证基于结构因果模型的归因正确性
- R8. 四种 Truth 类型使用 Zod 严格模式定义，并导出 TypeScript 类型。
- R9. 四种 Truth 类型在 `packages/contracts/src/evals/index.ts` 中重新导出。

### 治理 Eval Case 清单

- R10. 在 `packages/contracts/src/evals/manifest.ts` 中新增 governance 治理评测案例：
  - `governance-semantic-review-v1`：治理审核流程测试（候选提交 → 审核 → 决策 → 发布 → 回滚）
  - `governance-domain-coverage-v1`：领域覆盖完整性测试
  - `governance-role-permission-v1`：角色权限分离测试（proposer/reviewer/admin/publisher 隔离）
- R11. 每个治理案例包含 `GovernanceServiceQuality` 类型的 oracle，预期行为为字符串数组。

### 泳道分离

- R12. 定义 Eval Lane 类型：`EvalLane` = `"grounding" | "end-to-end-product" | "authorization" | "contribution"`。
- R13. 每个 Benchmark Suite 与一个 Lane 绑定：
  - `insightbench` → `grounding`
  - `dab` → `end-to-end-product`
  - `rcaeval` → `grounding`
  - `controlled-attribution` → `contribution`
  - `governance` → `authorization`
- R14. Lane 绑定在 `packages/contracts/src/evals/schemas.ts` 中以 `LANE_BY_SUITE` 常量映射定义。
- R15. 泳道信息在 ScoreCard 中记录，支持按 Lane 独立查询和聚合评分。

### eval:smoke 门禁更新

- R16. 在 `scripts/eval-smoke.ts` 的 U7 实现检测中新增 `"U7-adapter-governance"` 检测项。
- R17. 新增 `"U7-truth-contract-governance"` 和 `"U7-governance-eval-case"` 检测项，分别验证治理 Truth 类型定义和治理 Eval Case 清单。
- R18. 在 `eval:smoke` 的条件判断中新增 `"governance-adapter-v1"` 条件，要求治理适配器完整实现。
- R19. 在 `eval:smoke` 的 failure taxonomy 中新增 `"GOVERNANCE_ADAPTER_NOT_IMPLEMENTED"` 故障代码。

---

## Success Criteria

1. `pnpm typecheck` 通过（全包无类型错误）
2. `pnpm lint` 通过（Biome 无错误）
3. `benchmarkSuiteSchema` 包含 5 个枚举值（含 `"governance"`）
4. `GovernanceAdapter` 接口定义完整，类型约束正确
5. `governance-adapter.ts` 实现完整，遵循现有 Adapter 模式
6. 四种治理 Truth 类型定义完整，导出正确
7. 三个治理 Eval Case 定义完整，oracle 类型正确
8. `LANE_BY_SUITE` 映射定义完整，覆盖全部 5 个 Suite
9. `eval:smoke` 检测到治理适配器实现状态并正确报告
10. 治理适配器非治理 Suite 的误用被类型系统拒绝

---

## Scope Boundaries

- 不涉及 U11 治理服务本身的增强（U11 已完结）
- 不涉及 F9 归因的 published-governance（U13.2+）
- 不涉及 U13.0/U13.1 工作
- 不涉及治理服务的 PostgreSQL 数据验证（属于 U11 范围）
- 不涉及前端 UI 组件的变更
- 不涉及 API 路由的变更
- 治理适配器使用 Mock 数据模式（与现有 4 个 Adapter 一致），真实数据库接入不在本 delta 范围内
- 治理泳道分离不涉及数据库 schema 变更——Lane 信息在类型层面而非持久化层面分离

---

## Key Decisions

- **新增 `"governance"` 作为第 5 个 Suite**：而非在现有 Suite 中嵌入治理检查。独立 Suite 保持了架构一致性，且允许治理评估拥有独立的 oracle 类型和评分标准。
- **四种 Truth 类型作为独立类型定义**：而非在通用 Truth 类型中加判别字段。独立类型提供了更好的类型安全性和可扩展性，每种 Truth 可以有自己的验证逻辑。
- **Lane 分离通过常量映射实现**：而非在 Schema 中增加 Lane 字段。常量映射是零运行时开销的编译时绑定，且 Lane 和 Suite 的对应关系是固定的设计决策，不需要运行时动态关联。
- **治理适配器使用 Mock 数据**：与现有 4 个 Adapter 保持一致。真实治理服务接入属于后续工作，当前阶段聚焦于架构和类型定义。

---

## Dependencies / Assumptions

- U7 Eval 基础框架已完成（4 个 Adapter、Oracle Runner、Manifest Replay、Paired Comparison、Contamination Check、Safety Checks）
- U11 语义治理服务已完成（PostgreSQL 服务、API 路由、UI、Zustand store）
- 现有 Adapter 模式（`insightbench-adapter.ts`、`controlled-attribution-adapter.ts` 等）可作为实现参考
- 新增的 Governance Suite 不影响现有 4 个 Suite 的评分逻辑
- Lane 的分离只在类型层面生效，不涉及持久化迁移

---

## Outstanding Questions

### Deferred to Planning

- [Affects R6][Technical] 治理适配器的具体评估指标——Candidate Summary Quality 等维度的评分标准需要在实现时确定
- [Affects R10][Technical] 治理 Eval Case 的 oracle 预期值——需要在实现时根据 U11 治理服务的行为确定
- [Affects R12-R15][Technical] 泳道分离是否需要影响 ScoreCard 的哈希计算或权威验证流程
