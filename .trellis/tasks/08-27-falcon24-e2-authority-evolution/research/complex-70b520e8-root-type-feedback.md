# A2 Root Artifact 类型反馈闭包

## 已观察事实

非正式 scratch 构建 `70b520e8d7ed11a25a39be8812e1e96626aaed80`。
同会话 `07e84cef-2d32-48dd-86c0-3814dc0cb57f`：

- A1 `be350dfb-d5d7-8ff2-8c12-a06f8d11c295` 业务、原算法0差异、同Run UI/73节点Trace通过。
- A2 `5a6cac9a-6148-8dca-8706-98eb242cc425` FAILED，保留37事件。
  QueryEvidence `16f75b52-401d-8126-8db2-671fe3598d77` 有完整48行；来源只读Oracle验证窗口、值、同比、
  重组与最差月份（2024-08/09/10）全部通过。0自动图表说明重复x保护已在真实链路生效。
- 第3次 Root 原生调用 `call_00_9ibNs1VYngxpwILVaCwy4442` 选择 Analysis，输入却包含 QueryEvidence
  和 SemanticQueryContext；冻结 Analysis 目录不接受后一类型。
  Provider request `019e95be-b1e5-4a86-b300-d892ce5c9529` 已正常 COMPLETED；持久化响应
  `fbef92b8-fdd0-49c4-b880-26705705e76f` 原工具参数证明该错配，不是传输失败或 OUTCOME_UNKNOWN。
- 本地 Harness 返回 `ROOT_AGENT_PROVIDED_UNSUPPORTED_INPUT_ARTIFACT`；runner 立即结束。
  Analysis task/Stage 均未创建，没有 A2 答案/UI验收，也未提交A3。

原始脱敏证据位于本机审计目录 `complex-70b520e8/turn-02/` 的 `delegation-inspection.json`、
`terminal-observation.json`、`intent-binding.json`、`oracle-grouped-yoy.json`。
源348表在本轮前后完全一致；运行进程34391/34856/32335精确关闭，55498转发取消。
scratch容器停机、volume/历史保留，普通NAS数据库healthy，OrbStack仍关闭。

## 最小修复

只将本地尚未admission的两种Artifact类型拒绝（unsupported input/output）转为既有Root verifier feedback。
先保存原接受证据、下一turn index及固定错误码checkpoint，再允许模型依据冻结目录修正下一次native call。
不是Provider replay，也不由Host过滤参数、伪造成功Tool Result或扩大Analysis输入能力。

目录身份/未知Profile、权限/引用、协议错误与Provider不确定结果继续终止。
修复消耗原4回合；最后仍错误则保存预算耗尽终态，最后回合若产出合法最终证据则仅走原确定性验收。
不改变题目、公式、15回合计数、source Oracle、live authority或正式门禁历史。

## 验证与后续

- 3项失败测试先复现原立即终止；修复后全部通过。
- AgentRuntime 11 tests：真实normalizer拒绝额外Semantic输入，新的Query-only调用通过，旧参数保持不变。
- Worker 61 tests：两种反馈、完整输入/观察保留、敏感message不投影、checkpoint恢复不重放、持久化失败停止、
  原4回合耗尽及终态恢复、类型纠正后的最后回合最终证据/continuation/verifier拒绝和8类非白名单错误。
- Worker与AgentRuntime typecheck、scoped Biome通过。

上述只证明修复及数据子链，不把 A2 标为业务PASS。提交后新 clean build / fresh scratch 从A1验证同构建复杂多轮，
逐题业务通过后才验同Run UI。正式15回合尚未开始；live E16 FAILED及production isolation HOLD不变。
