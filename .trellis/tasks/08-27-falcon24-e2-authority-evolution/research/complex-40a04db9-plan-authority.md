# Bug Analysis: 分群分析计划所需维度未明确投影

## 1. Root Cause Category

B/D：计划与结果合同的跨层要求未完全投影，缺项被数据权限错误遮蔽。
40a04db9新构建A1 Run3c8d0bf6-9839-87ea-af6a-35f34f360366业务及同Run UI/Trace PASS（73节点/5接受产物），
原stage4bdde8ff-180a-5290-9767-f0af70ae5473独立算法0差异，受限事实摘要与原解释hash一致；不是正式V1 profile PASS。
A2 Run1ac1185e-569e-856c-a7df-7220ee17df50 FAILED/65events；已接受Semantic包含同比+12完整月，
QueryEvidence55ef6329-c173-8228-b2c2-1b9fbec72e4b的48行、整体重组、BOTH_PERIOD_GROUPS及8/9/10月排名独立PASS。
第一次Analysis在ANALYSIS_PROGRAM阶段拒绝SOURCE_AUTHORITY_INVALID；原失败候选未持久化，不能把推测当成具体候选证据。
现有代码和RED测试证明：即便来源有效，只要候选漏时间维度，也得到该误导错误；规划投影仅有结果hash，没有必需维度列表。

## 2. Why Fixes Failed

- 前序语义窗口修复已获本轮真实Semantic/Text2SQL证明，不能再归因缺窗口。
- 本轮A1受限事实摘要通过，但A2尚未进入解释；不是摘要机制回归。
- 原Run内Root再次委派Analysis后程序已编译，Python两次KeyError month_str，终止于CELL_EXECUTION修复预算耗尽。
  这是独立待修问题；没有Stage/Oracle/AnalysisReport，不能用SQL PASS抵消整轮失败。
- 不杜撰原候选字段或事后先验概率；新的维度缺失回归是定位同类缺陷，不是旧候选重放。

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Contract projection | 原结果合同投影必需Metric与完整有序Dimension，保留time window和数据角色 | DONE |
| P0 | Diagnostics | 原合同选择检查前移，数据来源验证不变，不补齐或替换候选 | DONE |
| P0 | Regression | 两项RED：缺维度误报码、缺required对象投影；转PASS，执行前拒绝 | DONE |
| P0 | Python preparation | 原月度分群合同派生列错误，需独立无模型复现及修复 | PENDING |
| P0 | Acceptance | 新clean build/fresh scratch重验整段A/B；formal15未开始 | PENDING |

## 4. Systematic Expansion

Focused：Worker 4文件82项PASS，typecheck、Biome、Trellis、diff检查通过；Trellis原超长文档提示保留，主线程已全文阅读。

必需对象来自选中方法的合同，而不是题目词、列名或黄金答案；不新建语义权威、不改SQL/Oracle/值/NULL/预算。
同比时间窗与维度选择是两个独立义务；有window不代表已选择时间维度。
旧Run终态与A1历史保持，未提交A3/B或执行A2 UI验收，不拼接跨构建通过项。

## 5. Knowledge Capture

- 更新Python Sandbox规范与implement；无src/templates/markdown/spec模板目录，不另建一套。
- 审计：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-40a04db9/turn-02` 的原终态、authority/planning inspection、grouped Oracle。
- 源348表before/after一致，live E16/migration10815不变，production HOLD；Web49661/Worker50123/OpenSandbox47168已精确停机。
  55495当前转发/browser/auth关闭；scratch停机保留volume与全部历史，共享SSH和普通NAS数据库保留healthy，OrbStack关闭。
