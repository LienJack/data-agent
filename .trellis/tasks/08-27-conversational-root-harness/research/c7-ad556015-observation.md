# C7 首轮真实观察与报告单位上下文修复

## 状态与证明边界

2026-08-31，clean source `ad55601507cfb04ab3ec1746d16756c12140d595` 的新隔离 scratch。
C7 **未完成**；旧 generation 1 阻塞不是当前阻塞。当前 generation 2 已能真实执行
Semantic → Text2SQL → Analysis。以下是一次非计分观察，不是 formal Gate PASS。

- Conversation：`5b0cb690-f542-4dda-b606-f8a88129c167`。
- Run：`bbfbde68-cf61-8c9e-a0db-281c26c5a1eb`，一次正常页面提交，持久化 `SUCCEEDED`。
- 问题：最近 12 个完整月订单收入趋势，按月并生成折线图。
- Run admission 的 ProviderTask V2 严格重验通过；当前消息及单条冻结历史匹配。
- 专用 NAS scratch `data-agent-falcon24-e17-ad556015`，loopback 55477。
  baseline `32e0d109-86be-55e0-9b9e-00f66b48e9f7`；未写入 live E16。

## 已证明

独立只读源表 SQL 核对 2023-11 至 2024-10 的 12 行月份及 `SUM(order_total)`；
QueryEvidence、两份 LINE 图完整原表一致，未截断。另以独立数值运算检查 S=-30、
tau=-0.4545、Z=-1.9886、Theil-Sen slope=-3891.33，以及 12 月/1 月环比。
此检查没有独立计算 p 值，不宣称对所有叙述统计做了全量复算。

SemanticQueryContext → SqlArtifact typed provenance → QueryEvidence source ref 与
release/context/hash 闭包匹配。该证据不等于后续多轮冻结历史、纠错或隔离验收。

## 未通过的报告审核与修复范围

1. 已发布 `unit.currency` 仅表示数据源币种，`base_unit=null`。原答案却使用“元”。
   根因是最终说明上下文只有 Oracle 摘要，没有传入已发布指标单位。
   本次最小修复在现有 final-message 边界传入当前 node 的 `metric_ref + unit`，
   要求未指定币种/单位时如实披露，禁止依据中文、地域或数据源名称猜测。
   这不是发布新币种，不修改 SQL/统计/Artifact hash 算法，也不是新增答案审批权威。
2. 原 `业务问题` 章节实际内容是 Root 的 Analysis 委派目标。续接的独立小修复仅将
   章节标题纠正为 `分析任务`；没有替换原始消息、委派目标或研究任务，也没有改动路由。
   这是标签文案修复，以 Runtime focused tests 与静态检查验证；不声称已做新的浏览器验收。

原 Run、原文本与失败观察保留；没有重提、改写答案或后补 PASS。业务审核后没有运行
Trace/UI 验收，没有提交第 2–6 问。Prompt 回归仅证明上下文改动，真实生成效果仍待新证据。

## 验证与回收

- 新单位上下文用例先观察到 3 failed，再修复；5 项 narrative tests 通过。
- Worker Team + Analysis：47 files / 502 tests 通过，`--maxWorkers=2`。
- Worker typecheck、变更文件 Biome、`git diff --check` 通过。
- 本轮所有 live 受保护表 before/after 指纹：348/348 相同，live 仍为 E16。
- 已停本轮 Web、Worker、OpenSandbox；关闭本轮浏览器并删除其认证 vault。
- 本轮 scratch 容器已停止、volume 与数据保留；仅取消 55477 本轮转发，不退出共享 SSH master。
- 删除本轮本地临时 capability 副本；没有删除数据库或 Keychain 正式凭据。

详细不可变观察在 `/Users/lienli/.codex/audit/falcon24-e1-authority-reset/c7-ad556015/turn-01/`：
`submission.json`、`terminal-observation.json`、`oracle-numeric.json`、`business-review.json`。
Observer 曾选错 WorkspaceDocument verifier，随后按 V2/V3 原有分派纠正；numeric helper
曾将 `projection.table.rows` 误写为 `projection.rows`，均为只读检查器错误，未重跑模型。

父任务仍 ACTIVE/in_progress；原四层最终门禁、C7 后续追问/新会话隔离与真实恢复证据未完成。
