# U18 Greenfield Semantic Mastra Team Falcon 端到端发布门禁

## Goal

在专属 fresh PostgreSQL 17 评测环境中，由 Semantic Management、Text2SQL 与 Report 三个受治理 Agent Profile 完成 Falcon 28 库语义发布与 500 题执行，生成可验证的最终 GO/HOLD Artifact。

## Requirements

### R1. Immutable Inputs

- 固定 Falcon commit `8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5`、source digest、28 库、DEV 309、TEST 191 与 Oracle version。
- U17 `WorkspaceJourneyEvidenceArtifact` 必须先通过 schema/hash/12-checkpoint closure。
- 使用专属 Evaluation Workspace/数据库；不得修写现有本地数据库的历史 migration ledger。

### R2. Semantic Release Set

- 一个 Falcon Workspace、一个 semantic domain、一个 generation 1 Release Set，内含 28 个 database-scoped package。
- `FalconSemanticBundleIndex` 精确绑定 database/schema/package/schema snapshot/admission receipt 与唯一 ReleaseSetHash。
- db24/db14 必须满足额外业务断言；任何 package 缺失、污染、未覆盖或 hash 漂移都阻止发布。

### R3. Agent Team Execution

- 每道题由 Worker FalconTeamRunner 创建 Orchestrator root task 和 Text2SQL child task；DEMO 10 与 db24 DEV 17 另建 Report child task。
- Text2SQL 必须调用真实认证 Provider，并保留 Profile、Invocation/Usage、Tool、Context、Team/Verifier 证据。
- 只有 Published Release 解析、Firewall、PostgreSQL executor 与 sealed Oracle 都闭合的 SQL 才能计分。
- 现有 inline Web runner、SubmittedAnswer probe、缺 Team Receipt 的 SQL 和客户端 PASS 不能得到 Verdict。

### R4. Dataset Isolation

- DEMO/TUNING 可诊断；Local Holdout 使用 blind pre-Oracle reflection，至少 4/5 PASS。
- DEV 的两个候选在 sealed Oracle 前冻结，Oracle derived feedback 不进入当前/后续 Agent Context。
- TEST 191 只生成 submission/trace，不计算本地 accuracy。
- Gold、expected、sealed/derived payload 不得进入 Provider、Public Trace、Report 或 Reflection。

### R5. Absolute Gate

- DEMO 10/10、db24 17/17、db14 32/32。
- DEV first-pass >= 217/309，post-reflection >= 248/309，每库 post-reflection >= 0.60，309/309 确定终态。
- 冷重启 Stability Suite（db24、db14、holdout 去重）无题级 flake。
- TEST 191/191 submission complete、unscored。
- U17 Journey、28-package release、Team/Profile/Usage/Invocation/Report evidence 与运行时健康全部闭合才可 GO。

## Acceptance Criteria

- [ ] Fresh PostgreSQL 17 安装当前全部迁移并导入/验证 28 个 Falcon schema。
- [ ] 28-package `FalconSemanticBundleIndex` 与 generation 1 Release Set 严格验签。
- [ ] Agent Team 使用真实 Provider 跑完 309 DEV 和 191 TEST；没有 probe SQL 或 inline Web bypass。
- [ ] 绝对分数、per-database、holdout、report citation、stability 和 sealed-taint 门禁全部通过。
- [ ] 500 题都有 Task/Tool/Context/Invocation/Usage/Team evidence；TEST 没有本地 Verdict。
- [ ] 最终 Gate Artifact 同时绑定 U17 evidence 与 Falcon execution evidence，并返回 GO。
- [ ] Contracts/Evals/Platform/Worker/Web 测试、typecheck/build 和 PostgreSQL 集成通过。
- [ ] U18 scoped commit/归档完成，随后才进入全站 `design-taste-frontend` 重设计。

## Constraints

- 不降低 28/500、绝对分数或每库阈值，不选择性重跑。
- 不把 Mastra snapshot、自然语言完成或模型自报当 Authority。
- 不要求 Billing/Pricing/Credit Receipt；只执行技术预算和 Provider 安全上限。
