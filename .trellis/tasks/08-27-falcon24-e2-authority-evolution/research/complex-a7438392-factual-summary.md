# Bug Analysis: 有完整正确序列仍产生相互矛盾的概括

## 1. Root Cause Category

Category B/E：把自由自然语言生成等同于已受验数值展示。a7438392新构建8/8（0cache）、full unit15/15（12cache）、
attestation PASS；NAS55494克隆348表与源一致，10816仅scratch、347业务表和source不变。
一次认证558a40ab-4f02-5131-a536-b0f5b7124ea3 PASS；scratch E17 baseline36c78734-f7de-543a-9732-e1fabdf9ec08，production HOLD。
Conversation08c3fb9c-cb93-49e9-97ea-67c117ca3259的A1 Run1e2d36fa-45fe-858f-baba-629386add178 SUCCEEDED/57events，
Semantic/Text2SQL/Analysis完成，Python首cell成功、无repair，stage51bb0ad0-447a-530e-8023-ae72750917a3独立算法0差异。
来源12本期/6同期完整验证；原摘要先列7月+0.96%，后称“2024年下半年同比增速持续为负”，与同一答案/源值矛盾，业务FAIL。

## 2. Why Fixes Failed

- 时间输入修复已解决日历错月，本次stage/来源再次一致，不能再归因时区或SQL。
- d9a91228已把完整12行受验observations交给FINAL并要求检查穷尽性表述，曾一轮通过，但本轮再次错误；
  因而“输入更完整+提示”不是自然语言事实校验。无法从现有证据推断模型内部原因，也不杜撰先验概率。
- a7438392语义窗口修复未在本轮A2受验：A1业务未通过即停止，本轮没有A2，不声称窗口修复真实成功。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Bounded presentation | 原月度/分组同比合同以受验结果生成事实摘要，按原映射，不按问题/标签猜角色 | DONE |
| P0 | Authority | 原Oracle之后重新绑定Run/QueryEvidence/Context/plan/contract及完整观测值/原算法 | DONE |
| P0 | Model output contract | 当前请求literal响应Schema+task hash；模型响应不符即拒绝，不后台替换 | DONE |
| P0 | Recovery | 记录前及恢复后的原解释hash/精确文本检查，原解释与权威链保持 | DONE |
| P0 | Regression | 原model边界2项RED转PASS；别名/时区/空值/单位/分组/篡改/隔离registry测试 | DONE |
| P0 | Business acceptance | 新clean build/scratch重验A1/A2/B及同RunUI；旧A1保持FAIL | PENDING |

最终focused验证：Analysis目录及两项dispatch测试37文件432项PASS，Worker typecheck、Biome、Trellis和diff检查通过。
两项额外初期RED是新fixture缺失comparison metadata，修正fixture后测试走完整原binding/plan；不计作生产缺陷。

## 4. Systematic Expansion

依据用户允许降低反复失败问题难度，此处不再考核月度同比的自由概括，而保留真实Semantic/Text2SQL/Python/Oracle/表图协作。
不是硬编码题库答案：输入源列、窗口、原值、原月度算法及单位决定文本；不新增语义发布权威、不改黄金值/SQL proof或原stage。
分组用已受验TOTAL_YOY_RATE/BOTH_PERIOD_GROUPS和百分点贡献；只列至多3类负向贡献并明确完整表可查，不称损失占比/因果。
响应约束只收窄内部FINAL，仍记录实际模型返回值/ref/hash；调用上限不增，不伪造provider或把旧Run重新签PASS。
其他合同自由解释仍需业务复核；本次收窄不是任意自然语言安全证明。正式V1 Agent profile不匹配仍单列，未冒充完整四层通过。

## 5. Knowledge Capture

- 已更新Analysis feedback、Provider invocation规范和implement；无src/templates/markdown/spec，不另建模板树。
- 原终态/语义hash/Oracle/stage完整字节保留在 /Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-a7438392/turn-01；
  business-review FAIL记录反例7月rate0.00964003746671051，未开始QA/Trace验收或下一轮。
- 源348表after/before完全一致；Web23633/Worker24097/OpenSandbox20283、browser/auth/55494转发、临时capability已精确清理。
  scratch停机、volume与历史保留；普通NAS数据库healthy、共享SSH不动、OrbStack关闭。
