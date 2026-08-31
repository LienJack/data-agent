# 完整分类同比：查询证明，不是业务验收

50bd A2暴露的错误不能只靠修改叙述解决。单侧current-group LEFT JOIN也不能证明分类全集，
因为仅上年同期出现的分类会遗漏，进而误算整体同期收入。本工作包只补查询证明与明确的输出角色。

## 同一证明/执行入口

- 仍使用两个exact current/prior聚合CTE、同一Published SUM来源、完整月、最多一个已认证非fanout维度关联。
- 新分支仅外层FULL JOIN；年度与NULL类别关联原样。当前/同期月合并成对齐的当前月，分类合并成原值。
  仅身份COALESCE，原始数值和派生rate不可补零，内层维度仍LEFT JOIN。
- 普通SQL firewall继续默认拒绝FULL。Worker原compile及adapter validate先执行无I/O证明，
  只有该候选的完整分组证明结果可给同一candidate设置Host许可；模型schema没有该开关。
- 新comparison metadata包含原列角色和分类覆盖，派生及binding hash封存；consumer结构验证同Metric、公式、时间、分类和窗口。
  历史无字段Artifact不增加默认值；单侧旧证明返回结构不变，不把老结果冒充完整分类范围。

## 实证边界

两个合法完整SQL先RED再PASS；原单侧group/ungrouped回归保留。
拒绝只取current身份、未平移fallback月、补零数值、FULL维度join等候选；元数据错引用、重用别名、错Metric/公式/聚合、
缺窗口、FULL却无分类、换成ratio均拒绝；原hash下交换本期/同期字段拒绝。
Worker独立接线测试只替换proof port，真实parameterizer/firewall执行；只有BOTH_PERIOD_GROUPS能放行，均无目标连接。
验证：Platform datasources14文件390项、Contracts两文件37项、Worker三个文件48项；三包typecheck、Biome、Trellis和diff检查通过。

NAS独立无网络tmpfs PostgreSQL执行保留7行，包括PRIOR_ONLY的同期200、本期NULL；
150/100→0.5、40/20→1、零分母与缺失同期NULL、覆盖外999不进入结果。事务回滚后纯测试实例精确停止并删除。
证据：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complete-yoy-nas-proof-ccde7d4b.json`。

这还不是同比拆解业务PASS。分析端必须仅从明确角色及完整范围计算整体同比，按整体同比增速选月份，
再计算组贡献；若任一必要数值缺失，不能把NULL当0或用部分组冒充完整整体。不得平均组内比率或用MoM选月份。
下一小任务补该结构化事实、独立Oracle与叙述范围，再新clean build/scratch做真实多轮。
