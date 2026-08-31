# 完整空响应：确定拒绝，不重放原调用

## 1. 根因与证据边界

B 跨层契约 / D 测试覆盖。d36893ad 的 B3 Run `b9122efd-7169-8476-ba26-16920ad62cad`
首个 Root、A2 Run `7dc91fcc-43da-88dc-9beb-ff9d50339afe` 在48行查询之后的 Root，分别观测到
216字节/216 delta/stop 和2048字节/2048 delta/length，均为空白且工具数0。原系统统一写为
OUTCOME_UNKNOWN；这些已提交历史不会被此修复重分类，私有计数不是事后恢复授权。

该次五个提交中 A1/B1/B2 业务与同 Run QA/Trace PASS（75/42/58节点），A2/B3整体FAIL；A3未提交。
B1原发布ROAS CASE首次候选通过；B2请求级净ROI正确、未发布公式；A1来源和原Python输出0差异。
首个认证stage失败，按既定规则创建独立新stage认证PASS后仅在scratch Finalizer激活；不把失败改写为成功。
具体不可变记录位于 `.turbo/falcon24-formal-support` 与原 audit stash；live348表指纹前后相等，
本次Web/Worker/browser停止、scratch停机保留、55502转发取消，NAS控制面留用，production isolation仍HOLD。

## 2. 既有处理为何不足

提示与JSON mode限制了协议，但不能保证非空生成。ModelProvider FAILED原来只表达未发送/结果未知，
因而无法区分“完整结束但无有效决策”和“断流或结果不可知”。单纯重试会破坏原调用的一次性边界。
曾检查Mastra吞掉native tool-error的假设：固定DeepSeek SDK + Mastra四种离线native参数试验未支持此假设，
不据此改路由或工具schema。真正修复点是原stream完成处的窄分类和持久终态后的Root正常回合。

## 3. 防复发机制

- 原stream完整drain、fullOutput无错、finish stop/length、无abort/工具活动、最终及streamed文本仅空白，
  已报告usage在冻结预算内时，bridge授予包内WeakSet标记。仅诊断字段、同形Error不具有该标记。
- Adapter产出唯一FAILED/MODEL_RESPONSE_EMPTY/known/non-retryable，绝不产出COMPLETED或工具候选。
  原持久transport记录FAILED/PROVIDER_PROTOCOL_VIOLATION，ResponseObserved后commitTerminal，
  call_count=1、recovery_action=NONE、无response artifact；未报告usage保持未知。
- terminal持久化成功才返回PROVIDER_RESPONSE_REJECTED；持久读回保留该分类但零网络重放。
  Root先checkpoint下一index，再进行新的正常决策，保留accepted inputs，消耗原四回合预算。
  失败的checkpoint或terminal commit不启动下一调用。Host不删参数、不代选Agent、不延长预算。

## 4. 同类边界与测试

未知finish、断流、非空非法JSON、fence、schema不匹配、工具活动、超预算、伪造diagnostic均不得成为确定空拒绝。
旧OUTCOME_UNKNOWN无论附加何种计数仍不可恢复。端口truth table、真实SDK单fetch与marker顺序、
持久化命令、commit失败、终态重放、正常Root checkpoint恢复及四回合耗尽均须覆盖。
Agent Runtime四个suite 71项、Worker五个suite 79项、Contracts 21项全部通过；三包typecheck、
owned Biome、Trellis validate及diff check通过。Trellis原有大文件注入截断warning保留；离线测试不是新复杂业务验收。

## 5. 知识固化与下一步

已同步Provider authority和Root runtime规范；`src/templates/markdown/spec`不存在，不新建第二套模板权威。
遵照Trellis break-loop，本项只处理已定位根因，不扩充题库或放宽来源Oracle。完成focused validation与scoped commit，
冻结新构建、创建新NAS scratch，再逐题A/B业务及同Run页面验证；formal15及L3跨域仍未验收。

## 6. 新构建前置检查

6bfb08c0 force build 8/8通过，全量单测在Contracts架构扫描失败：前序新增
`postgresql-formula-reference.ts` 从根入口导入两项类型。原构建的缓存Contracts测试未扫描该跨包变更；
改成原 `contracts/agents` 与 `contracts/artifacts` 领域子路径，不扩baseline、不改变运行逻辑。
架构15项、公式参考4项和Platform typecheck通过。6bfb08c0没有签发attestation、认证、激活或业务模型调用；
已创建的55503专用克隆及10816升级证明保留。后续新clean build重新执行全门禁。
