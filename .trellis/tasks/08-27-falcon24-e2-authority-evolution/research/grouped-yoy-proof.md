# 复杂 A2 前置：月度分类同比的有界证明

201ef834真实A2已证明接受的Context缺继承窗口；`b3c94e1a`补齐Specialist输入，但还不能通过原仅4列的同比证明。
本工作包扩展现有证明器，不发布新公式、不替换SQL执行通道、不缩减四层题目。

## 子集与来源

仅一个已选atomic/text分类维度，按源Metric允许维度验证。支持同表分类或单个已发布认证的非fanout LEFT JOIN。
跨表必须同时匹配当前Context和发布catalog的关系内容、原mandatory/selected闭包、快照及active物理键；
源码两侧精确等值关联，同期与本期同一维度口径。键与分类进入派生hash来源，不能借此选择其他列。
无变更旧4列输入证明/hash；新5列保留month、category、current、comparison、rate。

外层NULL类别使用显式等值 OR 双NULL条件，缺失维表不丢订单；零分母、缺同期保持NULL。
不接受额外筛选、LIMIT、错误年度对齐、错键、额外join、AVG/DISTINCT/FILTER/百分比缩放。
Text2SQL提示及原有限repair hints同步，仍只有原候选修复额度。

## 已验证

- 先观察2个合法分类候选RED；扩展后同表/跨表真实parameterize/deparse与source-coverage policy通过。
- SQL proof 67项，含漏分类条件、NULL分组丢失、错键、错NULL侧、过滤和截断反例。
- QueryEvidence binding 108项，含发布关系缺失/漂移、fanout、DECLARED_ONLY、禁join、右端强保留、
  不允许维度、不groupable、缺key binding、缺当前窗口、漏分类输出拒绝；LEFT JOIN分类nullable及5物理来源验证。
- 全datasources 14文件364项；Worker四个相关文件64项；Platform/Worker typecheck通过。
- NAS无网络、tmpfs合成PostgreSQL实例：本期150/同期100→0.5；零分母→NULL；缺同期→NULL；
  未匹配维表NULL类别40/20→1；覆盖外历史999不计入；6行独立预期完全相等。
  事务rollback后精确停止/删除该纯合成实例，无authority/model调用，未重启OrbStack。

合成证据：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/grouped-yoy-nas-proof-b3c94e1a.json`。
它也验证限制：只有同期出现的分类不属于当前组；不能靠本面板单独证明整体同期总额。
实际整体最差月份必须以当前Run完整聚合或独立数据Oracle核验，不取平均组内增长率或旧答案。

以上不是A2或正式15回合PASS。下一次必须新clean build/scratch，再检查Semantic接受窗口、真实SQL/Oracle及同Run UI。
