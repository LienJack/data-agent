# Bug Analysis: 排名子集不能改写取数窗口

## 1. Root Cause Category

B/E：Root 把排名数量与取数时间范围混用。a97bd856 A1 Run eff59bda-f93a-835e-adeb-67290a3657d9
完成业务校验与同Run UI/Trace（非评分）；同会话A2 Run b53f4e21-25e3-8a9f-a5b4-4a19f3d7d659 FAILED。
原ProviderResponseArtifact直接证明Root在SQL objective中预选历史3月，并在失败后要求Semantic缩短窗口。
两份已接受SemanticContext却均为继承12月+同比+客户分类，context hash相同且ambiguity为空。
Text2SQL两次Candidate在COMPILE阶段被TEXT2SQL_REQUEST_TIME_WINDOW_MISMATCH拒绝，candidate hash相同；
无SQL执行/QueryEvidence/Analysis Stage，后续Root返回AUTO_RESPONSE_INVALID_JSON/OUTCOME_UNKNOWN。
Candidate原文未持久化可读，因此不能断言其具体参数错误，也不能声称新Python参考已在A2运行。

## 2. Why Fixes Failed

- 既有Semantic缺窗保护有效，但Root误把SQL窗口不匹配等同于Semantic缺窗，向正确层提出错误修复。
- 既有Text2SQL完整面板提示与Root缩窗objective冲突，修复消息只有泛化提示，原预算内仍重复相同候选。
- 排序影响的初始假设通过原sealed authority prepare/compile回归排查：改变合法canonical id排列只改变
  REQUEST_DERIVED对应id，SQL、参数、时间窗口及校验不变。不能为此更改canonical排序或放松原校验。
- 现有代码对SQL值的拒绝保持正确；本修复是模型委派/反馈约束，非确定性模型成功保证。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Intent separation | 继承窗口供完整取数，排名数量交下游Analysis从本Run重算；不传历史获选日期 | DONE |
| P0 | Error ownership | 区分Semantic缺窗与SQL窗口冲突，不要求缩窗、不延长失败task预算 | DONE |
| P0 | Narrow repair | 明确使用原resolved_time_window与已证明Candidate，不改authority/候选或Oracle | DONE |
| P0 | Regression | Root/repair两项RED后GREEN；合法操作顺序和缩窗拒绝覆盖 | DONE |
| P0 | Fresh acceptance | 新clean build/scratch证明实际模型行为，再继续A/B和formal15 | PENDING |

## 4. Systematic Expansion

这一原则同样适用于最佳/最差分组、渠道排名等，但不新增题目字符串路由或默认窗口。
用户明确缩小时间范围时仍按其意图建立新语义；不得用“完整面板”忽略真实限制。
旧A2失败保留，不重放provider/composer、不提交A3、不进入A2 UI验收；历史A1 PASS不拼接新构建。
source-after 348表相同；旧专用容器已停止、卷保留、临时服务及会话关闭、共享NAS和SSH保留、OrbStack未启。

## 5. Knowledge Capture

更新semantic-conversation-intent规范及implement；无src/templates/markdown/spec目录，不另建权威。
原始证据在审计目录complex-a97bd856/turn-02/failure-inspection.json、intent-binding.json、
business-review.json与complex-a97bd856-runtime-cleanup.json。无模型/数据库写入的诊断不等于业务验收。
验证：Agent Runtime 9项、Worker 44项focused全部通过，两包typecheck、Biome、Trellis和diff检查通过。
