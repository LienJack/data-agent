# Bug Analysis: L2-02 被 Root 的时间窗口与 semantic-only 改写截断

## 1. Root Cause Category

- **Category**: B — Cross-Layer Contract；E — Implicit Assumption。
- v6 attempt `a9782700-abc4-47ab-b1b9-68d6032dab6c` 已在同一 build/scratch 连续通过 L1 五题和 L2-01。
- L2-02 Run `755a7323-6797-8da7-a8bf-31d88bb9008a` 的 route decision、retrieval 和 inference 均证明
  `formula.marketing_roas` 已发布且在 frozen closure；不是缺公式、缺索引或 datasource 问题。
- Root 前两次 delegation objective 自行要求“当前窗口/时间语义”，Semantic 两次以
  `TEAM_SEMANTIC_SELECTION_OUTSIDE_FROZEN_CLOSURE` 正确拒绝。第三次 objective 改成 `semantic-only` 后提交了合法
  `SemanticQueryContext`，但 Root 随即最终回答，不再委派 Text2SQL；实际 profile 只有 Semantic、无 QueryEvidence/表格。

## 2. Why Fixes Failed

- v2 题面已给出 `formula.marketing_roas` 与 ratio-of-sums，但仍允许 Root 自由扩写 Semantic objective。历史 v5 attempt 曾通过该题，
  只说明模型有时选择正确，不能让正式门禁依赖抽样运气。
- 运行时 frozen-closure 守卫和 exact Agent business gate 都按设计工作；放宽 allowlist、把 Run SUCCEEDED 当 PASS，或重放同一 attempt
  都会破坏证据合同。
- 直接新增公式也不对：发布公式已存在且被精确选中，重复发布会创建第二语义权威。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Manifest v7 | L2-02 枚举四个已发布对象，明确不选额外时间/关系 | DONE |
| P0 | Handoff | 明确只执行 Semantic→Text2SQL 两步，不得在 Semantic 后结束 | DONE |
| P0 | SQL scope | 明确全量数据和不得添加日期过滤 | DONE |
| P1 | Compatibility | v1～v6 blueprint 与 hash 按 schema version 保持不可变 | DONE |
| P1 | Database gate | 10822 只在 exact post-10821 函数上追加 v7 hash | DONE |

## 4. Systematic Expansion

- L3/L4 仍保留复杂 Semantic→Text2SQL→Analysis 业务问题；未因本次 L2 随机失败预先降级后续 rubric。
- v7 只收敛模型可见任务合同，不新增 Host 关键词 Router、固定 DAG、模型响应修补、SQL 模板或 deterministic Tool Call。
- 旧 attempt 的六题 PASS 只作诊断前缀；新 v7 必须来自新 commit/build/fresh physical scratch/fresh attempt 的15题单链路。

## 5. Knowledge Capture

- [x] 更新 Agent runtime spec、PRD、design、implement。
- [x] 仓库无 `src/templates/markdown/spec/`，不创建影子模板。
- [x] focused validation、真实 PostgreSQL v1～v7 replay/mix、migration ledger 与 RPC owner/SECURITY DEFINER/ACL 通过。
- [ ] scoped commit 后从新 build/fresh physical scratch 启动 v7 正式15题单链路。
