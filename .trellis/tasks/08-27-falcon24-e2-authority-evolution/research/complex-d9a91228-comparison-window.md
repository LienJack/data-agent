# Bug Analysis: 追问同比未建立可执行窗口

## 1. Root Cause Category

Category B：Semantic selection 到可执行上下文的完整性边界过晚。
d9a91228 新构建8/8、full unit15/15、attestation PASS；NAS55493独立物理克隆348表一致，
仅scratch10816、347业务表不变，9表70列121445行1902NULL一致。一次认证通过并激活scratch E17，production HOLD。
A1 Run aaa40e76-a493-8696-877b-1c62402df0cc SUCCEEDED/57events；当前12/比较6个月独立来源通过，
原stage 1df82410-8264-55c1-84d3-157e2093060a完整字节/hash与原月度算法0差异。
摘要正确区分6/7月正同比和8至10月降幅收窄；同Run QA刷新/Trace73节点及5产物通过。
这是非计分业务/UI PASS，不满足正式V1要求Report profile的证明，也不拼入formal15。

同Conversation d1ec1186-1eea-4813-bb2c-87aa77015d80 的一次A2
Run 55e3fda7-74cd-8315-987b-5818e6bc4838 FAILED/50events。
仅接受Semantic f50b9891-c15b-8c19-a70f-155525ed8610：同比、月份、客户类型与关系齐全、无歧义，
但操作只有PERIOD_COMPARISON_RATE，缺少RECENT_COMPLETE_PERIODS，窗口resolver返回null。
Text2SQL在准备阶段三次拒绝QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID，未生成候选或执行SQL。

## 2. Why Fixes Failed

已有历史意图投影并未丢失：frozen history含A1原用户问题，intent/retrieval两项hash一致。
新增更多历史或放宽SQL proof都不针对这次已观察缺陷。旧提示已有同时输出窗口要求，但模型仍遗漏；
Host直到Text2SQL才拒绝且反馈不区分缺窗口，Root重复调用未获得可执行语义。
不杜撰排查前概率；决定性证据是当前已接受上下文、resolver为null与prepare前置代码，未推测模型内部原因。

| 假设 | 区分证据 | 判断 |
|---|---|---|
| A1时长未进入冻结意图 | 原用户问题和已校验hash保留 | 不支持 |
| SQL候选结构不支持 | prepare拒绝，尚无候选或查询 | 非本次首因 |
| 语义缺窗口被过早接受 | 原上下文只有同比操作、resolver null | 已证实 |

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Completeness | 已消歧DATA同比上下文在commit前校验原窗口resolver，缺失给专用错误 | DONE |
| P0 | Feedback | Semantic从当前/历史用户时长补齐；Root原预算内回到Semantic，无法确定就澄清 | DONE |
| P0 | Compatibility | 纯定义无需窗口、已声明歧义保留、完整窗口正常接受 | DONE |
| P0 | Regression | 缺窗口测试先RED；Worker134、Agent Runtime8与两个包typecheck通过 | DONE |
| P0 | Acceptance | 新clean构建/scratch重新验证A/B，不重放旧Run或拼接A1 | PENDING |

## 4. Systematic Expansion

这是当前受支持同比结果路径的约束，不宣称所有未来窗口类型都只支持RECENT_COMPLETE_PERIODS。
不增预算、不注入默认12月、不继承旧Run Artifact、不新增发布权威；原数据绑定、发布身份与SQL proof不改。
测试覆盖拒绝前零commit/零Text2SQL；prompt测试只证明反馈存在，不等于真实模型必然修复。
A1业务通过仍有英文委派目标、原始警告code等编辑问题；不把这些当新A2数据失败的原因。

## 5. Knowledge Capture

- 更新backend/semantic-conversation-intent.md和implement；不存在src/templates/markdown/spec，不另建模板树。
- 原审计保留于 /Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-d9a91228/turn-01 与 turn-02。
  A1 business-review/result PASS为非正式；A2 business-review FAIL含实际上下文和失败事件，未做A2 UI。
- source348表after/before相同；Web91235/Worker91694/OpenSandbox90364、browser/auth/55493转发及临时capability精确清理。
  scratch停止、volume/历史保留，共享SSH及普通NAS数据库不动，OrbStack关闭；未提交A3/B或formal15。
