# Bug Analysis: 请求派生验证漏掉 mandatory Relationship metadata

## 1. Root Cause Category

- B / D：Semantic selection 与 Worker prepare 允许 inference receipt 中的 mandatory_relationship_ids，结果层却仅认普通选中对象和 Metric 时间域。
- 初始假设为候选问题55%、绑定层误拒45%；原 accepted Context 配合已知合法合成 Candidate 仍在 SQL 证明前拒绝，使证据转向绑定层。
- 实测 Scope/Run/回执/发布/快照/物理绑定全相等，未命中普通 selection 的两个 ID 分别为合法时间域与 mandatory Relationship；
  原验证器已处理前者但漏掉后者。历史失败 SQL 不可恢复，不推测各候选表达式。

## 2. Why Prior Coverage Was Insufficient

1. 月度与净 ROI fixtures 都没有显式 requested Relationship；旧 scratch 同比成功不足以覆盖所有合法 Context projection。
2. 查看父提交确认遗漏早已存在，不能把本次暴露误称为净 ROI 改动引入。
3. 同样的合法 SQL 在 Context membership 处必然失败，增加模型重试或改表达式不能解决。
4. 真实 Worker 从包 dist 消费 Platform；源码测试变绿后必须重建再做只读探针，不能将旧 dist 的失败解释为第二根因。

## 3. Prevention Mechanisms

| 优先级 | 机制 | 状态 |
| --- | --- | --- |
| P0 | 只承认 Context 实际投影、verified inference 授予的 Relationship metadata | DONE |
| P0 | executable selection、源对象/SQL/Join/时间窗口证明保持不变 | DONE |
| P0 | 两算子正例 RED→GREEN；未授予关系/输出冒充/回执篡改拒绝 | DONE |
| P1 | 原 accepted Context + NAS 只读源 + 真实 compile 重放，明确不算模型 PASS | DONE |

## 4. Systematic Expansion

- 区分请求 metadata 闭包、可执行对象选择、实际 SQL 使用三个集合；不能把它们合成一个更宽的权限集合。
- 本次仅结果层 membership 与回归/spec/docs；不增加 publisher、schema、SQL支持子集或重试次数。
- 同比与净 ROI 共用入口都测试；模型生成、ROAS、Analysis 和完整15回合仍由新构建验证，不以离线探针替代。

## 5. Knowledge Capture

- [x] backend/text2sql-resolved-context、design§25.18、implement 现场同步；本仓无 src/templates/markdown/spec，未制造模板副本。
- [x] Platform233/233、Worker90/90；两包typecheck、Platform build、Biome/diff、Trellis validate通过（原两份大文件警告保留）。
  只读探针12个月/6个同期 NULL、独立源金额/rate一致。
- [ ] scoped commit、clean full build/unit、fresh scratch五题及随后同Run QA/Trace；再满足正式入场条件。

live E16 FAILED、E17 未激活，任务 ACTIVE；失败证据和物理 scratch 保留，无 CE/子代理。
