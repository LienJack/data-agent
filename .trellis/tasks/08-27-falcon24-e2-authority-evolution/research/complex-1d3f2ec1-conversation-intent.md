# Complex L4 scratch — 1d3f2ec1 多轮意图断点

## 已观察证据

- `1d3f2ec19c298a763bdf7bde55b03bd140d386f1` clean build8/8、full unit15/15、attestation通过；
  NAS `data-agent-falcon24-e17-1d3f2ec1` /55486，仅scratch原认证/Finalizer ACTIVE。
- A1 Conversation `d0d90f7d-df4c-443c-85f8-1010465a946f`，Run `d0f3a536-0d60-8f8a-adcd-da5c83771bf6`
  SUCCEEDED /60events；Semantic→Text2SQL→Analysis，1次Python/零repair。
  12个月当前值、发布覆盖内6个同比、覆盖外NULL、表图/ref/hash通过；同Run QA/Trace/刷新通过（76节点、5个accepted artifacts）。
- A1是**有限定的non-scoring诊断PASS**：保留内部英文任务段落、年份括注不精确等editorial警告；不认证错误括注。
  原formal profile预期Report而实际为Analysis的差异仍需正式冻结前处理，不冒充formal15回合。
- A2同Conversation唯一提交“其中下降最明显的3个月，按客户类型拆开看看，主要差异来自哪里？”。
  Run `75f52783-faee-8b89-88fa-d6bc00647b0e` FAILED /55events，无SQL/accepted artifacts。
  4次Semantic中2次 `MODEL_STREAM_PROTOCOL_VIOLATION`、2次 `TEAM_SEMANTIC_SELECTION_OUTSIDE_FROZEN_CLOSURE`，最后Root预算耗尽。
  后续A3/B组未提交；live348表before/after完全一致。Web/Worker/OpenSandbox/browser已停止。

## Bug Analysis: Root 与 Semantic 冻结输入不一致

### 1. Root Cause Category

**B — Cross-Layer Contract**。Root已从冻结3条可见历史正确传递订单收入同比/客户类型的目标，
但Semantic loader仅加载当前qa_message。A2包只冻结customer_segment及新客/复购/留存对象，
遗漏order_revenue、order_month与order_customer。不能归因于纯粹随机失败，不能放宽Specialist选择校验。

### 2. Why Fixes Failed

- A1的FINAL/NULL修复解决了上一断点，但未覆盖多轮语义检索。
- 初稿只传历史exact词法，离线重放找回收入与join仍缺月份；混合检索补历史后，
  月份排在候选15/18，仍被单句12个optional预算挤掉。保留两次失败重放，不调用模型碰运气。
- 改为distinct question分配optional预算并保留总80节点/160边/3hop及显式更小预算。
  新弱匹配容量回归先因夹具排序不合规修正，随后获得真正缺月份RED，修复后GREEN。

### 3. Prevention Mechanisms

| Priority | Mechanism | Action | Status |
| --- | --- | --- | --- |
| P0 | 同一冻结来源 | 原Task authority在Semantic前commit，Root随后replay；request exact Task ref | 实现，focused通过 |
| P0 | 来源/意图分离 | DB仅投影最多8条历史user/text，当前question不改；当前release重新检索 | 实现，focused通过 |
| P0 | hash闭包 | intent/query附加hash进入receipt；DB commit独立重算，不变更旧记录 | 最终稿NAS clean/populated通过 |
| P0 | 容量而非旁路 | 多句有界候选预算，原scope/release/mandatory/选择拒绝边界保留 | 实现，8项focused通过 |
| P1 | 真实续验 | 新build/scratch复杂A/B链→同冻结正式15回合 | ACTIVE |

### 4. Systematic Expansion

旧回答与旧Artifact不能成为新Run事实；但丢掉历史用户意图也会使Root理解正确而Specialist无可选对象。
两层必须共享同一冻结Task来源，检索线索与发布权威分别验证。
离线真实A2重编译从13个候选恢复到29个，所需收入/公式/月份/客户类型与order_customer均存在，
current question/hash/route不变。这不是已提交语义Receipt或新Run业务PASS。

### 5. Knowledge Capture

- [x] 新叶子 `semantic-conversation-intent.md` 路由到任务implement/check；原门禁/历史不可变。
- [x] 初稿NAS clean install与populated clone通过，347业务表不变；补commit附加hash重算后的v2稿发现PL/pgSQL IF中CASE表达式须加括号。
  已确认10816 ledger=0、三项原函数hash和reader grant完整回滚。最终稿先rollback preflight，再在该完全回滚克隆安装；不覆写初稿ledger。
- [x] 最终10816 checksum `sha256:50bf05c298ba99189238f087faf6ec20366f3f9d68917631e006465490bdf4bf`；
  clean-v3全链和新增SQL断言通过、upgrade-v3证明347业务表及原source348表不变。未应用live。
- [x] Contracts10项（含6种metadata配对）、Semantic29文件185项、Worker53文件629项、Platform8项、migration/renderer/inventory12项通过；
  Contracts/Semantic/Platform/Worker类型、相关build、12文件Biome、Trellis validate/diff check通过。
  inventory测试此前停在10812，已更新为真实10816/next10817；不放宽checksum或迁移连续性。
- [x] 本轮6个专用NAS测试容器停机保留，55486转发取消，临时capability文件移除；业务数据/日志/volume全部保留。
- [ ] scoped commit后fresh build真实复杂Run；无模型重放不替代验收。

证据：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-1d3f2ec1/`、
`intent-10816-replay.json`、`intent-10816-clean[-v2/-v3].log`、`intent-10816-upgrade[-v3].json`。
