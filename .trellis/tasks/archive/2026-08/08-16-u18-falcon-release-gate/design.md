# U18 Technical Design

## 1. Execution Boundary

U18 使用独立 PostgreSQL 17 Evaluation Database，标准迁移链从空库安装。现有本地数据库 10653 checksum 漂移只作为 preflight blocker evidence，不被更新、删除或重签。

Web 只 enqueue/read；Worker 内 `FalconTeamRunner` 组合 Agent Profile、Provider、Context、SQL Sandbox 与 evaluator-only Oracle。`packages/evals` 保持纯数据集/Oracle 层，不读取 Workspace secrets 或 Agent registry。

## 2. Contracts

`falcon-semantic-release-set.ts` 定义：

- 28 项 `FalconSemanticBundleIndexEntry`；
- exact `database_id/schema_name/package_ref/schema_snapshot_hash/admission_receipt_ref`；
- one `release_set_ref`、`first_release_receipt_ref` 和 `bundle_index_hash`；
- per-case `FalconSemanticUsageReceipt`；
- per-case `FalconTeamCaseEvidence`；
- top-level `FalconAgentReleaseGateArtifact`，绑定 U17 artifact、dataset、model/profile、scorecard、submission 和 stability。

所有 schema strict，所有 artifact 排除自身 hash 后 canonical SHA-256，required set 缺失/重复/失败一律拒绝。

## 3. Semantic Bootstrap

从 Public Falcon schema/corpus 确定性生成 28 个 physical-core package；Semantic Profile task 产生 Candidate/coverage evidence，非模型 Bootstrap Authority 只发布 exact evaluated set。db24 使用现有完整 ontology，db14 增加 mandatory business assertion；其他库至少有 table/column identity、queryable mapping、join evidence 和 provenance。

整个 set 只消费一次 Publisher Grant，生成 generation 1；没有 28 个独立 generation。

## 4. Team Case Runtime

每个 case 的执行顺序：

1. root Orchestrator task 冻结 public case、Profile refs、ReleaseSetHash 和 budget；
2. Text2SQL child 解析 package/context，调用认证 Provider，生成 SQL；
3. Firewall/executor 运行候选 SQL并形成 QueryEvidence；
4. evaluator-only Oracle 读取 sealed expected result；
5. Verifier 接纳或拒绝 case evidence；
6. DEMO/db24 由 Report child 生成 claim/citation projection；
7. 公开 trace 仅保留 reasoning summary/tool identity/status/hash。

DEV blind reflection 在 Oracle 前冻结 attempt 0/1。TEST 不调用 Oracle。

## 5. Persistence And Recovery

PostgreSQL Authority 保存 batch/case/task/attempt/evidence/terminal transition。唯一键为 dataset digest + case id + frozen execution identity；lease/fence/idempotency 阻止重复 Provider effect 和重复 verdict。OUTCOME_UNKNOWN 只能 reconcile。

CLI 是 Worker composition entry，不绕过同一 runner/authority。它输出内容寻址 artifacts，便于长跑恢复和最终审计。

## 6. Gate Evaluation

Gate verifier机械检查绝对阈值、309/191 完整性、per-database floor、holdout、stability、report citations、sealed taint、28-package closure、Team evidence 和 U17 evidence。任何 infrastructure/security/oracle failure 计 HOLD。

## 7. Rollback

停止 Evaluation Worker，保留 evidence，删除专属临时容器/数据库即可；不修改开发数据库和生产 Authority。代码回滚不改变 Falcon 固定快照。
