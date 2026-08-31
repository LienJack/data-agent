# Bug Analysis: Root 时间范围交接与历史后的响应协议

## 1. Root Cause Category

- **B/C — Cross-Layer Contract / Change Propagation Failure**：B1 的 Text2SQL prompt 已解释 coverage 不是默认过滤，
  Root 却连续3次将 published frontier 写入 objective。Semantic只选择渠道Dimension，没有请求窗口或时间Dimension。
  子层修复无法纠正上层反复强加的范围；SQL两次候选分别被 time binding out-of-range / missing window拒绝。
- **D/E — Test Coverage Gap / Implicit Assumption**：A3首个Root AUTO无工具输出未通过JSON解析；历史后仅有turn index。
  日志可证明错误分类，不能证明具体输出内容或模型为何选择该格式。增加回合末协议/证据提醒是预防性调整，
  不是已证明能修复历史响应，更不能将 OUTCOME_UNKNOWN 改为已成功。

构建 `5d1cf6f052dd98f6368e51214d05618e10cb3df4`，scratch E17 baseline
`5a3e5cbe-02fc-584f-aafc-85abece840d2`，正式门禁未启动。

| 回合 | exact Run | 已观察边界 |
| --- | --- | --- |
| A1 | `6bc3de14-1628-8794-a631-5e8873a365e2` | 12行/同比/Python原算法0差异，业务+73节点UI PASS |
| A2 | `bc8303da-6e8a-8f94-8a20-c81beed7992b` | 48行/原算法0差异/整体排名/贡献，业务+76节点UI PASS |
| A3 | `9e8728cc-080a-8735-9aa7-2cdc1a85f22c` | 5事件、0子Agent/Query；Root响应协议失败 |
| B1 | `57a2b1b5-a66a-806c-ae54-9d069b5aadf5` | Semantic接受，3个SQL task失败、0Query；Root预算耗尽 |

A2一次 `ANALYSIS_RESULT_TABLE_TYPE_UNSUPPORTED` 在原publish-symbol预算内纠正；最终Stage
`59c05109-3556-552c-9123-a7aad0a0e861` 原bytes/hash和结构化输出通过独立验证，未隐藏原拒绝。
A3 request `99bbf53d-1e70-4b02-b318-061c78ceb349` 只调用一次，5,381ms后保留OUTCOME_UNKNOWN；
Worker日志333行的白名单诊断为 `AUTO_RESPONSE_INVALID_JSON`。原响应文本未保留，不复原/猜测其内容。
B1 `delegation-inspection.json` 保留原Root calls，明确写了2023-05-01至2024-11-01覆盖期过滤；不是由历史A组污染，
该会话冻结历史只有当前用户问题，独立intent/retrieval hash匹配。

## 2. Why Fixes Failed

1. 排名窗口修复解决A2的“排名数不等于窗口长度”，真实A2已通过；它没有定义无界总量与覆盖元数据之间的边界。
2. 子层时间错误反馈已经存在，Root未同步该约定，仍向新SQL task发出同样的错误范围；不能继续增加候选次数。
3. 完整Root schema在初始system中存在；A3仍违反协议。仅知道解析阶段失败，不能据此声称额度、网络、摘要或双图能力失败。

本次先查持久化Tool参数、semantic对象、稳定日志，再归因；不补造事前概率。
原Root参数直接支持B1范围错配，置信度高；“历史较长导致A3忽略协议”仍只是可能解释，需fresh运行检验。

## 3. Prevention Mechanisms

| 优先级 | 机制 | 已实施内容 |
| --- | --- | --- |
| P0 | 跨层范围契约 | Root不为无界总量加入coverage过滤；显式/继承窗口仍须保留并解析合法Dimension |
| P0 | 严格拒绝保留 | SQL/Provider解析/Artifact权限/4回合与候选预算不变；失败Run不重放 |
| P1 | 回合末协议 | 历史、观察、反馈之后提醒native call或严格JSON；无current Artifact时不把历史视作证据 |
| P1 | 回归 | AgentRuntime38 + Worker57 tests通过；两个typecheck和scoped Biome通过 |

7项RED先复现缺失规则/消息边界后转GREEN。Pinned bridge仍覆盖无工具合法JSON和非法格式拒绝；
audited Root coordinator证明追加提示在原消息投影内，非第二Provider/答案通道。

## 4. Systematic Expansion

- 覆盖范围、用户选择窗口、排名子集是三件事；下游SQL错误应先反查Root当前objective，不能默认重建Semantic或再试SQL。
- 格式提醒不替代可执行Schema，提示测试不等于业务验收。General knowledge仍可直答，Host不按问题关键词强制路由。
- A3失败后已执行独立B1检查，避免把未测问题留到后续重建；B1失败则不提交依赖它的B2/B3。
- 还需核对正式题库强制Profile与实际Artifact责任的一致性；A1/A2非正式PASS不替代完整15回合。

## 5. Knowledge Capture

- [x] 更新 `agent-team-runtime.md`：coverage/request范围及回合末响应协议。
- [x] 更新当前implement检查点，保留A1/A2通过与A3/B1失败的不同状态。
- [x] 源348表前后无漂移；关闭62034/62501/56983，取消55499转发；两个浏览器/auth profile关闭。
  scratch容器停机/volume保留，普通NAS数据库healthy，OrbStack关闭；live E16 FAILED未写。
- [x] `src/templates/markdown/spec`不存在，未创建第二套规范。
- [ ] scoped commit后新clean build/fresh scratch验证实际效果，再继续完整四层验收。

本机证据：`complex-5d1cf6f0/turn-01..04/`、`complex-5d1cf6f0-after.json`、
`complex-5d1cf6f0-runtime-cleanup.json`。任何旧Run、构建、UI PASS均不拼入新attempt。
