# Bug Analysis: 数值通过但摘要错配月份与增长状态

## 1. Root Cause Category

Category B/D：Oracle结果到最终摘要的证据投影不完整。47916676新构建8/8、full unit15/15、attestation PASS；
NAS55492物理克隆348表一致、仅scratch10816、347业务表不变，9表70列121445行1902NULL一致。
认证79bdca41-bd3c-5b4d-a8b1-8a8014bf117f PASS，E17 baseline a54a7dea-e3a1-55da-bfd2-7379e990e5f7，production HOLD。

一次A1：Conversation d8569308-3bd6-4a27-a4f1-d6369a25471f，Run fc596f5d-cb61-8c37-9a09-bbba1c7e32e3 SUCCEEDED/57events；
Semantic/Text2SQL/Analysis接受。独立来源核对12本期/6可比较月、QueryEvidence/语义/SQL绑定通过；
原stage 3759e143-582c-5502-bdd7-b43b4af20473与所有产物字节/hash保留，原独立月度算法逐项差异为0，
证明时区输入修复已通过本次真实结果发布。但自然语言写“2024年5月为唯一正增长月份（+6.70%）”“此后连续下降”，
与实际5月-5.60%、6月+6.70%、7月+0.96%、8月-12.39%、9月-9.18%、10月-7.03%不符，业务FAIL。

## 2. Why Fixes Failed

时区修复解决的是Python结果字段，这次不能把已经匹配的结果与另一个未受数值Oracle验证的自然语言阶段混为一谈。
原FINAL投影把全部数组省略，仅留collection_count和measure极值/排名；已验证的12个月完整日历序列没有进入摘要。
具体measure_3.highest已经包含6月、7月两个正值，故“摘要缺数据”不能完全解释模型为何仍写错：
这是一个证据表示缺口加模型事实误述，不宣称已恢复模型内部推理或某一提示绝对能消灭错误。

| 假设 | 区分证据 | 判断更新 |
|---|---|---|
| 时区错误仍在Python结果 | stage与独立算法0差异，highest明确6/7月 | 被本次结果反证 |
| 数据库/同比源值错误 | 当前Run独立SQL/窗口/原QueryEvidence一致 | 被反证 |
| FINAL证据省略/自然语言误述 | 源码统一省略数组，答案与已受验排名也不符 | 高置信定位到FINAL边界，不能保证修复前瞻结果 |

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|---|---|---|---|
| P0 | Projection | 唯一已受验月度多结果合同保留完整12行聚合observations，不重算/改值/取样 | DONE |
| P0 | Budget | 原8KiB字段/24KiB总量不变；超预算、其他合同/数组继续省略 | DONE |
| P0 | Interpretation | 明确排名不等于时间顺序，负同比不等于同比单调下降；穷尽性表述必须完整序列支持 | DONE |
| P0 | Regression | 三个新失败先RED，144项focused及Worker typecheck PASS | DONE |
| P0 | Acceptance | 新clean构建/scratch/Run重新业务验收，原成功Run仍业务FAIL | PENDING |

## 4. Systematic Expansion

不能把自然语言未经验证的推断称为Oracle FULL覆盖；原Oracle只保证结构化结果。
不通过文本正则替换旧答案、不把错误降成编辑提示、不改写成功Run状态或为了继续A2签业务PASS。
此次只投影已公开受治理的12行聚合结果，不开放raw input/operator数据；分群总体与贡献仍走原period_comparison。
复现探针只重建当前修复的FINAL输入并验证原stage，不调用模型，不证明旧Provider请求字节或新摘要一定正确。

## 5. Knowledge Capture

- 更新backend/analysis-agent-feedback.md与implement；src/templates/markdown/spec不存在，不另建模板树。
- audit：/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-47916676/turn-01。
  terminal-observation、intent-binding、oracle-yoy、stage-evidence、business-review(FAIL)与summary-chronology-regression保留。
- 348张源表after/before相等；Web69102/Worker69567/OpenSandbox68159及browser/auth/55492转发/临时capability精确清理。
  scratch停止、volume和证据保留，普通NAS数据库healthy、共享SSH保留、OrbStack未启动。未提交A2/B，未做QA/Trace验收。
