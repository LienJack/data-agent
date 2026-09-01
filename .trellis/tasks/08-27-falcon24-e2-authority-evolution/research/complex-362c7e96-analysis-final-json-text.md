# 362c7e96 Analysis FINAL literal 传输复盘

## 不可变现场

- A1 `95a12be2-4dea-8384-a48f-815f4f17f057` 与 A2 `9efeb574-8589-86ca-8a2a-d41bd0d16e48` 在同一
  `362c7e96` build、fresh物理scratch上完成独立业务与同Run QA/Trace。
- A3唯一Run `79a82d53-432a-8475-ad1c-64a9cdd89449` 终态FAILED，68个公开事件。首个Analysis候选Program因时间窗未批准被拒；
  Root在原四回合预算内正常发起第二次Analysis委派，不是Provider retry。
- 第二个受验双节点Program使用正确12月分群同比QueryEvidence。第一个节点完成；第二节点完成Cell与FULL Oracle后，原FINAL Provider请求
  正常结束但Mastra以顶层`invalid_type`拒绝`analysis-agent-final@1.0.0`，随后出现投影冲突和Root预算耗尽。
- 原子Program未提交Analysis Artifact；失败Run未重放或改写。live before/after 348表完全一致且仍E16，旧A1/A2不进入新构建计分。

## 根因与边界

Executor已在FULL Oracle后生成受验事实摘要，并通过`final_summary_constraint`把原两字段schema的`summary_zh`收窄为精确literal。
当前request-isolated registry descriptor仍沿用默认`STRUCTURED_OUTPUT`；真实响应在Mastra结构化对象边界失败，尚未进入executor的逐字校验。

规范禁止用第二次模型调用修复、后台用Host文本替换响应、放宽schema或拼接已完成节点。Semantic、Text2SQL、QueryEvidence、Oracle和摘要内容
不是本次失败根因；修复只应改变同一次零工具调用的受控传输表示。

## 前向修复

仅当内部合法`final_summary_constraint`存在时，把该request-isolated literal descriptor固定为`JSON_TEXT`。Agent Runtime由同一Zod schema
生成canonical JSON Schema instruction，原SDK发一次`json_object`、零tools请求；完整原文经JSON.parse、同一literal strict schema、
canonicalization和executor逐字断言后才可记录Explanation。无约束Analysis FINAL仍为Structured Output，共享registry及预算不变。

聚焦测试先稳定复现`STRUCTURED_OUTPUT != JSON_TEXT`，随后验证受约束请求的JSON_TEXT、两个literal隔离、task hash变化、无约束兼容，
以及非法阶段/约束零调用拒绝。Worker聚焦26、受影响dispatcher/Analysis 72、官方unit 101与Agent Runtime JSON transport 51项全部PASS；
两个包typecheck/build、owned Biome、Trellis validate及diff check通过。组件通过不等于业务PASS；scoped commit后必须新clean build、
fresh物理scratch并从A1重跑六题。
