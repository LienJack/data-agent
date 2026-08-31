# 201ef834 复杂 A2：检索已绑定，Specialist 遗失继承窗口

## 真实运行边界

Clean `201ef8348e4a459f85d81a6c5a7a01176f5ac906` force build 8/8、full unit 15/15。
NAS scratch `data-agent-falcon24-e17-201ef834` / 55488，原认证及 Finalizer 仅作用该克隆。
Live 保持 E16 FAILED / 10815；scratch 独立应用10816。不是正式15回合尝试。

- A1 `338f4a1e-b449-8958-b3f7-aae0a6b6caca`：独立12月收入/6月有效同比/缺口NULL核验通过，
  同Run QA/Trace 76节点、5 accepted artifacts、刷新通过。实际 Semantic/Text2SQL/Analysis，不能代替旧题库的 Report profile要求。
- A2 `23444ce9-5e1b-83e0-936c-a6f78a97ca7d`：FAILED / 74 events / ROOT_AGENT_TURN_BUDGET_EXHAUSTED。
  同一会话 `39e02008-cc80-4ac1-b92b-eebb69dc476f`，每题仅提交一次；未提交A3/B，未验收失败A2的UI。

## 已证实的契约缺口

1. A2原冻结Task保留A1“最近12个完整月的订单收入同比”问题。当前Run检索29个对象，收入/月/客户类型/订单客户关系
   都在闭包内；独立重算 intent_context_hash 和 retrieval_query_hash 相符，816d检索修复确实生效。
2. 接受的 SemanticQueryContext `616ef44a-fa1e-84b5-92e7-0fd4b1585a95` hash
   `sha256:6458a1242c6fb69bfa7414c78676adc39c7925fd706994420c614eca6dc1f35d`
   只有 PERIOD_COMPARISON_RATE，没有 RECENT_COMPLETE_PERIODS。resolver不能构造当前窗口，派生绑定拒绝。
3. 代码显示 Semantic模型只收到当前追问、Root委派objective和catalog，原历史用户意图只送到了检索，未送到Specialist。
   因此补齐原冻结Task的同一有界投影，不从旧答案推导窗口，不为测试题硬编码日期或口径。
4. 独立代码检查还发现既有同比AST证明只支持两列聚合CTE/四列输出、无分类维度或维度表join。
   分组同比仍需单独离线修复和反例证明，不能补完prompt后立即继续调用模型。

三次Text2SQL委派均无accepted QueryEvidence。保存的终态有候选hash/诊断，但不含每次完整SQL；
不能从hash倒推具体错误SQL，也不能声称已证明所有失败候选的精确语法原因。

## 本次最小修复

Semantic dispatch复用原Task幂等commit；scope/Run/Conversation/version/当前问题/visible refs检查失败则不调用模型。
最后8条prior user/text（不含当前问题、assistant或summary正文）携带Task ref/context selection hash；
Specialist派生request hash包含该投影。当前纠正优先；模型负责消歧并生成request operations，Host仍严格验收。
Root和其他Specialist原路径不变，无新数据库权限、迁移、发布权威或重试额度。

Focused validation：新增dispatch回归12项；Worker providers/Conversation builder/semantic resolver合计16文件86项通过，
Worker typecheck、Biome、Trellis context validation、git diff check通过。Trellis原有两份超32KiB上下文警告未新增。
离线测试验证模型输入边界，不宣称模型已选择正确窗口；下一真实Run仍须检查接受的operations。

## 安全收尾

本轮live前后348张表指纹完全相同。Web/Worker/OpenSandbox 21554/22017/20677已精确停止；
本轮browser/auth及capability文件删除，55488转发取消，共享SSH不动。scratch停机保留volume/checkpoint；
普通NAS PostgreSQL/Neo4j健康，OrbStack关闭。旧数据库、备份与浏览器会话没有批量清理。

私有证据根：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-201ef834/`；
`turn-02/{terminal-observation,intent-binding,business-review}.json`，以及同级
`complex-201ef834-{before,after,runtime-cleanup}.json`。业务四层仍未通过，任务保持ACTIVE。
