# Bug Analysis: selected Metric 的跨表时间来源

## 1. Root Cause Category

- **Category**: E — Implicit Assumption；B — Cross-Layer Contract；D — Test Coverage Gap。
- E14 L1-04 Run `8b2b9e3e-e110-8735-a050-23b8d6549fee` FAILED/74 events；四个候选在 COMPILE 被拒，
  后续 Semantic 成功不代表订单问题完成。无 SQL/QueryEvidence，失败 turn/attempt 已不可变封存。
- 已发布的 delivery_minutes/on_time_rate Metric 位于配送表，time_column_id 合法指向 `blinkit_orders.order_date`。
  无窗口反向守卫遍历选中 Metric，错误要求 time ID 以 Metric 本表为前缀，因此无论本次合法订单 SQL 如何表达都会误拒。
- 初始可能性包括 SQL 类型投影、隐藏时间过滤或绑定解析；实际冻结 catalog/context/snapshot 的只读离线探针直接返回
  `QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID`，并由最小单元反例复现同表假设，支持高置信度修复此确定缺陷。
  原候选全文未持久化，不能通过 hash 证明其具体语句，也不能由离线 PASS 推断模型一定正确。
- 证据：audit `formal-e14-74813f90-b428c7ca/runtime/{failed-run-source,temporal-guard-reproduction,temporal-guard-reproduction-after}.json`。
  两条 SQL 均为标明的合成探针；provider_calls=0、datasource_query_calls=0，只读取已有权威。

## 2. Why Fixes Failed

1. `bb23f0bb` 正确补上 null-window 的反向检查，但测试只覆盖同表 Metric，隐含本表假设未被揭露。
2. ROAS canary 覆盖其自身 selected closure，不覆盖最近订单的配送 Metric 时间来源；不能把它视为全目录证明。
3. 不回退时间限制守卫，不改发布目录，不增加重试；新增正向跨表排序和负向隐藏过滤成对测试。
4. Worker 消费 Platform dist；直接跑测试会执行旧构建。记录该失败并重建依赖后重验，不把旧 dist 失败当作源码修复无效。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Runtime | 同表复用 Metric dependency；跨表复用 exact column/datasource/lifecycle/snapshot binding | DONE |
| P0 | Authority | 时间来源只用于拒绝遗漏，不授权窗口/Dimension，不更改发布数据、Candidate 或历史 hash | DONE |
| P1 | Tests | qualified 与 column-prefixed 跨表 ID；缺失/错 binding/stale snapshot；正向排序、负向隐藏过滤 | DONE |
| P1 | Integration | Worker compile/execute 检查 zero I/O，依赖先 build，保持原 adapter 错误边界 | DONE |
| P1 | Verification | 新 build 的 fresh scratch 最近订单 oracle/QA/Trace，并复验 semantic-only/ROAS | PENDING |

## 4. Systematic Expansion

- 此函数被 compile、adapter admission 和 evidence acceptance 共用，一处解析修复覆盖三条入口，不另建解析器。
- selected 元数据是限制识别的输入，不意味着 Metric、Dimension、时间列必在同一物理表；所有来源仍须 exact binding。
- 负向守卫的测试必须配真实可表达的正向形状，否则“全部拒绝”也能通过安全测试。每轮新失败先离线确定原因，再 fresh build。
- 历史失败活动和通过前缀保留；E15 不继承 E14 前三题 PASS，不修改原 rubric/oracle 以迎合结果。

## 5. Knowledge Capture

- [x] 更新 backend/text2sql-resolved-context.md 的跨表来源契约和失败矩阵。
- [x] 更新当前 task design/implement，记录 E14 不可变失败与 E15 前置验证。
- [x] 仓库无对应 src/templates/markdown/spec，不创建第二份影子规范。
- focused tests/typecheck 结果见 implement；离线修复完成不代表四层业务完成，task 保持 in_progress。
