# 966760f5 B3 Semantic JSON Text 传输复盘

## 现场事实

- fresh scratch `data-agent-falcon24-e17-966760f5` 绑定 clean commit、exact build/generation、专用物理数据库与 E17 scratch authority。
- A1/A2/A3/B1/B2 已分别通过独立来源 Oracle、Semantic/Text2SQL/Analysis 证据、业务复核和同 Run QA/Trace/刷新；A3 恰好两张确定性图。
- 原 B3 Run `abc6512e-ab54-8db1-baeb-1b775b2bbcc5` 四次 Semantic 调用均在
  `semantic-query-selection-intent@1.0.0` 的 `STRUCTURED_OUTPUT_REJECTED` 失败，Root turn budget 用尽；零 Semantic/SQL/Analysis Artifact。
- 独立显式定义诊断 Run `73028fd2-eb86-8691-8d65-23e64610f080` 写明净 ROI 公式、零分母、两完整月、先渠道筛选、再人群展示和非因果建议，仍四次同形失败。
- 八次 Provider 均有已观察终态与用量，response artifact 只含空白；没有候选可安全修复。live 348 表未写，scratch 数据/历史保留。

## 根因与边界

重复定义不能改变 DeepSeek 零工具 Mastra Structured Output 的空白响应，因此根因是 transport representation，不是语义定义、SQL、数据或用户歧义。
不能把失败改为任意文本接受，也不能用 Host 关键词直接构造 selection；Semantic Agent 和原 strict schema 仍是必需边界。

## 前向修复

- response schema registry 默认 `STRUCTURED_OUTPUT`，仅 exact Semantic selection schema 由服务端固定 `JSON_TEXT`。
- 原 SDK 发一次 `json_object`、零 tools 请求；完整原文先 JSON.parse，再过原 Zod strict schema 与 canonicalize。
- 空白、非 JSON、围栏、尾随文本、额外字段和错类型全部拒绝；不提取、修补、重放或增加调用预算。
- marker、usage、known rejection、protected ProviderResponseArtifact、Semantic Host closure、Text2SQL/Analysis/Oracle 和 authority 均不变。

## 证明边界

离线真实 SDK wire 与 focused tests 只能证明 adapter 合同；修复必须在新 clean build/fresh scratch 真实跑通 B3 的
Semantic -> Text2SQL -> Analysis、独立 Oracle 和同 Run QA/Trace 后才能记为业务 PASS。`966760f5` 的五个 PASS 和两个 B3 FAILED 均不拼接到新构建。

提交前已通过 Agent Runtime unit 193、integration 46、security 67、contract 32、focused 51 tests，Worker official unit 101、focused
114 tests，以及两个 package typecheck/build、owned Biome、diff 和 Trellis validate。以上只证明本地合同，不替代新构建的真实 Provider/业务验收。
