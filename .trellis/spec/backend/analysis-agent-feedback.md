# Analysis Agent 输入与解释反馈

## 1. Scope / Trigger

修改`analysis-agent-prompt.ts`、`analysis-tool-loop.ts`或`executor.ts`的模型输入、错误反馈和Oracle后解释时适用。
根运行契约仍是[Python Sandbox执行](./python-sandbox-execution.md)，不新增发布或事实权威。

## 2. Signatures

- `buildAnalysisAgentInitialMessages`：受治理输入schema、绑定symbol、固定runtime与result合同。
- `safeCellErrorIdentifier` / `cellRepairInstruction`：无数据的错误类别与等权限修复说明。
- `buildAnalysisFinalMessages({ objective, result_summary, metric_units, ... })`：Oracle后的唯一解释上下文。

## 3. Contracts

- 逻辑DATE/TIMESTAMP不保证pandas datetime dtype；Arrow文本或Python date可落为object。
  `.dt`前只对声明的日期列在派生Series上显式`pandas.to_datetime(..., errors='raise')`；保留日历日期、timezone、NULL和行。
  禁止coerce为NaT、改变protected input或推断新时间窗。已规范化ISO DATE可直接保留。
- 不发送stdout/stderr/raw error；固定pandas accessor消息须精确匹配，拒绝未知/带数据后缀/异常类型不符。
  原CELL_EXECUTION最多一次repair，strict模式零次；AST、算子、Oracle和Publisher校验不放宽。
- FINAL保留当前ResearchBrief的objective，视为意图而非事实；只解释相关经营结果，不穷举辅助序列统计，
  不把比率的相对变化误称为新的业务增速。仍只返回原`schema_version/summary_zh`两字段。
- 缺失按字段读取：变化NULL不代表两个端点NULL，首端NULL不代表末端NULL；0是观测值。
  `RELATIVE_DELTA_UNDEFINED`是结果级限制，不能据此反推所有measure；被摘要省略不等于源值缺失。
- 数值Oracle成功不是自然语言正确性证明；真实业务复核仍可在Run SUCCEEDED后记录独立FAIL，不能改写原Run。
- `monthly-multi-measure-comparison.result` 的已发布、Oracle逐项验证过的完整12行聚合 `observations` 可原样进入
  FINAL的`fields.observations`，按已批准业务日历保留period/value/NULL/顺序；不重算、切片、采样或生成新事实。
  仍受单字段8KiB/总24KiB限制，超预算整字段省略，不扩大任意原始数据或operator输出的模型可见范围。
  其他contract、非12行及其他collection仍不投影；分群同比优先使用原`period_comparison`，不以此改变分群摘要合同。
- `highest/lowest`按值排序，不是按月份排序；总行数不能重建每月值。只有完整时间序列能支持“唯一、全部、连续、单调”等
  穷尽性表述；序列省略时不能从排名/缺失总数猜完整序列。同比为负与同比增速持续下降不同，必须区分降幅扩大和收窄。
- `largest_drops` 仅原序列相邻月变化，不能称同比；组统计不能称整体。分类同比只依据受验 `period_comparison` 的
  `TOTAL_YOY_RATE/BOTH_PERIOD_GROUPS`；增速贡献按百分点展示，不称损失占比。对象缺失/摘要省略须披露不能建立该拆解。

## 4. Validation & Error Matrix

| 固定AttributeError消息 | 安全码 / 修复 |
| --- | --- |
| `Can only use .dt accessor with datetimelike values` | `PANDAS_DATETIME_ACCESSOR_REQUIRES_CONVERSION`；显式转换声明日期列 |
| `Can only use .str accessor with string values!` | `PANDAS_STRING_ACCESSOR_REQUIRES_STRING_VALUES`；仅声明字符串列、NULL保留 |
| 未知/带行数据的其他消息 | 不按以上规则投影；保留原有受界identifier策略 |

## 5. Good / Base / Bad Cases

Good：first=null、last=20时只说明首端缺失，整体变化未定义。
Base：first=0、last=20时绝对变化20，相对变化未定义，两个端点均存在。
Bad：根据一个全局限制码写“两端均缺失”，或为了继续运行把坏日期变成NaT。

## 6. Tests Required

- 真实NAS Agent image中Arrow DATE32与ISO文本转DataFrame的object dtype；显式转换后日期不变，无网络/数据源写入。
- 固定错误正例、类型不符/数据后缀负例；provider消息和进度不泄漏raw output；一次repair后原Publisher仍闭合。
- objective投影；非对称NULL、0分母证据不变；原两字段响应、来源货币限制和摘要预算不变。
- focused回归不算真实业务或UI验收；后续按同构建/same Run独立复核。
- 月度完整聚合序列原样保留、跨年/非对称NULL/多个正增长月；错误contract、超12行/超预算仍省略，其他collections不泄漏。
  生产Oracle成功后进入同一FINAL投影；保留原stage hash的离线输入复现不是原自然语言答案修复或新业务PASS。

## 7. Wrong vs Correct

Wrong：`relative_change=null` → 两个端点都缺失。
Correct：分别读first_value和last_value，说明实际缺失端；若仅摘要省略，不推断源数据状态。
