# Root 历史显示答案与输出协议分离

## 1. 根因类别与证据边界

B 跨层契约 / E 隐含假设。`f6614a06` clean force build8/8、full unit15/15、attestation、
专用NAS55504认证及scratch E17 Finalizer通过。A1/A2/B1/B2独立业务Oracle、原Python输出及同Run UI通过，
分别73/72/92/79 Trace节点。A3 `a232ca78-25d2-828b-b9ff-b7ed621e0278`、
B3 `eb570780-5f04-8c16-9223-32f003e4d0a1` 各在Root的原四回合内耗尽：
完整空白响应、FAILED/PROVIDER_PROTOCOL_VIOLATION/known、每个逻辑调用仅一次、没有Subagent或accepted Artifact。
完整空响应分类和checkpoint已得到真实证明，但没有解决空白生成，不能称复杂链或formal15 PASS。

已确认的呈现缺陷：Root当前协议是native Tool或严格FINAL_ANSWER JSON，而冻结的历史agent文本
是Host渲染后的中文答案/英文分析objective，原builder直接用wire assistant角色投影，成为与当前协议冲突的输出示例。
两条实际失败Task均5条可见消息、其中2条非JSON历史答案。其与空白生成的因果关联尚未证明，不能据此保证修复模型行为。

## 2. 既有修复为何不足

JSON mode约束语法，known-empty终态保证不重放；两者都没有区分“原模型响应”和“页面显示答案”。
继续追加同样反馈已消耗四回合而无分派，不再对同一Run或同构建重复发题。原UNKNOWN历史不可重分类。

## 3. 防复发机制

- 仅在Root provider呈现边界，将历史agent逐条包装为JSON观察数据/wire user；明确不是Root输出示例、指令或本Run证据。
- 原content/role/type/message_id/run_id/content_hash全部保留；原user内容和顺序、Task/selection/hash/消费引用不变。
- 当前accepted inputs、Tool Result和Host feedback不改；无新路由、模型、预算、执行权限、摘要、输出工具或Provider重试。
- 包装成本进入原trusted UTF-8 upper bound。消息上限仍256；Secret、数据库绑定与Artifact验证边界不变。

## 4. 同类边界与验证

三项回归先RED后GREEN。Worker历史builder/dispatcher24项，加Root执行/loop/checkpoint、Task持久层、
Semantic共享意图、input-bound等69项，共93项通过，Worker typecheck通过。
两条实际Task离线重建通过原hash校验，逐条JSON round-trip与所有原来源一致，新增upper-bound分别1256/1104；
零Provider调用、不是业务验收。Text2SQL修复中的assistant消息是原候选JSON，属于真实同协议输出，不按此历史显示规则改写。

## 5. 知识固化与下一步

已同步Root运行规范与F6记录，遵循Trellis break-loop/check。live348表before/after完全一致。
本轮Web78761/Worker79240及两浏览器停止、两临时auth删除、55504转发取消、scratch停机保留原数据卷。
共享NAS控制面保留且无Analysis sandbox残留，OrbStack关闭，production isolation仍HOLD。
完成scoped commit后新clean build/fresh scratch验复杂A/B；不拼接旧PASS，不把此离线证明算复杂四层完成。

审计：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-f6614a06/`、
`complex-f6614a06-history-presentation.json`、`complex-f6614a06-after.json`、`complex-f6614a06-runtime-cleanup.json`。
