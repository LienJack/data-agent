# ce2a488d Root 到 Analysis 输入收窄复盘

## 不可变现场

- build：`ce2a488d8395ade10e44cd54c5056b09771f1bfa`
- scratch：`falcon24-e17-ce2a488d`，独立 PostgreSQL system id `7678467078472929314`
- Run：`605a3f62-4ee1-8a45-98a6-31e55d179053`
- 结果：FAILED，终态 `ROOT_AGENT_TURN_BUDGET_EXHAUSTED`；原 Run 未重提。

A1 的前两次 Root 原生调用分别委派 Semantic 与 Text2SQL，成功提交 SemanticQueryContext、SqlArtifact 和 12 行 QueryEvidence；
QueryEvidence 带一张 12 行折线图。后两次 Root 原生调用都选择 `governed-analysis-agent`、请求 AnalysisReport 并标记
`FINAL_ANSWER_EVIDENCE`，但 input refs 都是 `[QueryEvidence, SemanticQueryContext]`。冻结 Profile 只接受 QueryEvidence，故两次都在
admission 前以 `ROOT_AGENT_PROVIDED_UNSUPPORTED_INPUT_ARTIFACT` 拒绝；checkpoint 只保留前两项 accepted observations。

诊断只读取 ProviderResponseArtifact 的 invocation id、hash、长度、tool/profile/ref 类型及 checkpoint 固定错误码；没有输出受保护原文、
objective、工具参数正文或凭据。live authority 未写入。

## 前向边界

Harness 对混合输入做一次单调收窄：仅保留 selected Profile 明确接受、且已由原调用提供的 exact refs。只有保留数量至少为一且小于原数量
时才应用；全无效输入不变并由原 Catalog 校验拒绝。Profile、objective、output usage、requested outputs、预算、tool call id、保留引用的
bytes/identity/order 都不得变化。

该行为不选择 Agent、不补引用、不扩权、不增加 Root/provider/tool 回合。受保护 ProviderResponseArtifact 仍保存原响应，正常 admission receipt
保存实际执行引用；后续 accepted Artifact/scope/hash/authority 校验不变。

## 证明要求

- TDD：`[QueryEvidence, SemanticQueryContext] -> [QueryEvidence]`；`[SemanticQueryContext]` 仍拒绝；调用方参数对象未突变。
- focused/full tests、typecheck/build、Biome、Trellis validate、diff check 后 scoped commit。
- 修复提交后的 clean force build 与 fresh 物理 scratch 从 A1 重跑六题；旧 A1 的 Semantic/Text2SQL 不计入新构建 PASS。
- 新业务 Run 必须真实进入 Analysis、原 Oracle/Publisher，并完成同 Run QA/Trace；组件测试不是四层验收。
