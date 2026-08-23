# TIS 定向语义重构设计

## Authority 边界

运行时只有一条链：Published Semantic Release → 当前 lexical projection → exact-first resolver →
policy/capacity → Resolved Context Package。PostgreSQL 是权威；relationship/search projection 可重建且
必须绑定 release/checkpoint/digest。Candidate、草稿和模型召回永远不是运行时事实。

维护链独立：Schema Drift Event → current release physical binding match → dependency closure → immutable
Binding Impact Receipt → Candidate review → publish。Planner 不执行发布写入。

## 单版本策略

- “V2-only”表示当前实现只存在一个可调用契约和一条 runtime path，不表示保留 V1 适配器。
- 历史 migration 文件保持不可变；新的 forward-only migration 可删除旧函数/表并建立当前对象，但不搬运
  历史数据。
- Contract breaking change 同步修改所有仓库内消费者、fixture 与测试；完成前不提交半兼容状态。
- 运行故障降级只允许从可选 knowledge/graph projection 回到同一当前版本的 lexical authority；它不是
  旧版本 fallback。

## 分层职责

- Contracts：strict evidence/artifact schema、canonical order、digest verification。
- Semantic：lexical resolver、clarification、binding impact planner；纯函数优先。
- Platform：PostgreSQL current-only authority 与 append-only receipt。
- Web：workspace-scoped safe projection、READ/WRITE capability 分离、Studio 内治理闭环。
- Falcon/Test Center：B0/B1 只作评估标签，不保留旧 runtime implementation。

## 暂缓边界

M2 governed retrieval 不预建 provider、向量库、空 UI 或 feature framework。只有 M1 后 unresolved 缺口
无法通过显式 glossary/alias 修复时，才新建子任务。运行时 lexical 与 exact relationship read 的故障 reason
仍需完整。
