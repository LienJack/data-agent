# 总体同比及分类贡献：分析事实闭合

## 原因与范围

50bd A2把组内环比当总体同比。查询端已补精确期间与两期分类全集证明，
本小任务沿既有 `published-monthly-group-panel@1` 增加对应结构化事实与独立 Oracle，不增加问题路由或另一套权威。

## 规则

仅从已接受当前 Run 的 QueryEvidence metadata读取本期/同期/月/分类/rate列；需BOTH范围、同一可加Metric。
每月两侧分别按源行顺序逐项相加，任一NULL不做部分合计。以总体同比（非组均值/金额/环比）选最多3个负同比月，
同期总额必须正数，平局按月；不足3月不补造。组增速贡献=组收入差额/总体同期额，以百分点展示，不当损失份额或因果贡献。
原组月度统计/表/图和全部NULL保留，新增对象进入受治理结果合同，不向执行合同预填源数据或答案。
独立Oracle重验真实Arrow后重算所有事实，依赖模块进入implementation digest；自然语言仍须真实业务复核。
摘要优先保留同比对象，8KiB单字段与24KiB总限制不变；缺对象不能以历史或环比补算。

## 验证

新算术测试先RED（模块缺失），后手算通过：8/9/10月总体-.625/-.5/-.4，与组均值不同；分类贡献-.125/-.5。
覆盖缺失、零组基数但有效总体、非正总体基数、有限溢出、4分类摘要预算。
权威fixture明确只是unit：metadata角色读取、缺metadata/单侧范围/不可加拒绝。
真实Arrow+schema-valid unit Sandbox receipt经生产Oracle，手算12月/一次下降/零基数和叙述投影通过；
重新封hash并同步unit输出目录后，总体/排名/贡献/漏组/漏对象/错基准仍RESULT_MISMATCH。
8个Worker focused文件204项及Worker typecheck通过；旧月度/分类与合同回归不变。

这不是A2业务PASS，也不是四层验收或生产隔离证明。下一步新clean build、full unit、attestation及NAS隔离scratch，
每轮一次真实提问，先独立业务Oracle再sameRun QA/Trace；原失败和live E16保持不动。
