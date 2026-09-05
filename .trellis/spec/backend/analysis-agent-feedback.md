# Analysis Agent 输入与解释反馈

## 1. Scope / Trigger

修改`analysis-agent-prompt.ts`、`analysis-tool-loop.ts`或`executor.ts`的模型输入、错误反馈和Oracle后解释时适用。
根运行契约仍是[Python Sandbox执行](./python-sandbox-execution.md)，不新增发布或事实权威。
`analysis-program-compiler.ts`把模型候选DAG编译为受验Program时也适用，尤其是条件节点的结构去重。

## 2. Signatures

- `buildAnalysisAgentInitialMessages`：受治理输入schema、绑定symbol、固定runtime与result合同。
- `safeCellErrorIdentifier` / `cellRepairInstruction`：无数据的错误类别与等权限修复说明。
- `publishRepairInstruction` / `allowedTools`：Publisher拒绝后的精确无数据反馈与`CELL_REQUIRED -> PUBLISH_REQUIRED`工具收窄。
- `buildAnalysisFinalMessages({ objective, result_summary, metric_units, ... })`：Oracle后的唯一解释上下文。
- `buildVerifiedMonthlySummary`：原FULL Oracle后、原当前Run Context/QueryEvidence/contract重新绑定的同比事实展示。
- `analysisFinalResponseSchema` / `assertAnalysisFinalSummary`：当前请求的原两字段响应收窄和接收/恢复校验。
- `collapseExactDuplicateConditionalLeaves(nodes)`：仅删除与直接`ALWAYS`前序执行身份完全相同、同criticality、仅依赖该前序且无人依赖的条件叶节点。

## 3. Contracts

- 逻辑DATE/TIMESTAMP不保证pandas datetime dtype；Arrow文本或Python date可落为object。
  `.dt`前只对声明的日期列在派生Series上显式`pandas.to_datetime(..., errors='raise')`；保留日历日期、timezone、NULL和行。
  禁止coerce为NaT、改变protected input或推断新时间窗。已规范化ISO DATE可直接保留。
- nullable NUMBER 的 Arrow NULL 在 pandas 中可表现为 `None`、`numpy.nan` 或 `pandas.NA`；`to_dict` 不保证转成 `None`。
  在派生副本上先用 `None if pandas.isna(value) else float(value)` 规范化并拒绝非缺失的非有限值，再做计数、排序、排名和算术。
  不能只测 `value is None`，也不能等 Publisher 的 JSON 规范化补救已算错的统计；0 是有效观测。禁止补零、跨缺口、移动端点或修改原输入。
- 月度比较的原 `execution_contract` 可携带无数据 `preparation_reference`、精确 `source_columns/time_column/time_logical_type/timezone/measure_fields`。
  Agent 将参考函数复制到实际 Cell，使用原 bound DataFrame 计算并经原 Publisher/FULL Oracle；Host 不执行参考、不注入计算结果或修补原 stage。
  Oracle 仍独立从原 QueryEvidence/Arrow 验算，不引用参考函数；原方法、结果 schema、公式、模型预算及正式题库不变。
- 不发送stdout/stderr/raw error；固定pandas accessor消息须精确匹配，拒绝未知/带数据后缀/异常类型不符。
  原CELL_EXECUTION最多一次repair，strict模式零次；AST、算子、Oracle和Publisher校验不放宽。
- Publisher拒绝进入原`PUBLISH_SYMBOL_CONTRACT`单次修复预算后，状态机必须先只允许一条修复`python_cell`；
  第一条成功修复Cell之后只允许`publish_analysis_result`，使用相同修复绑定重新经过原Publisher。不得继续暴露任意Python
  让模型重复转换或重算；若重新发布仍不合法，沿用原预算终止。表类型拒绝只反馈合法容器形态（exact-column DataFrame，
  或非空built-in list of built-in dict rows及稳定key顺序），要求保留行、值、NULL和顺序；不返回数据或扩大timeout/repair预算。
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
- 用户允许降低反复失败问题的难度后，当前月度同比/分组同比采用受验事实摘要，不再把模型自由概括当作必备能力。
  仅适用上述两个原月度合同且含明确PERIOD_COMPARISON_RATE映射；按合同/源角色选择，不按题目、列名或测试数据路由。
  原FULL Oracle先完成；重验同Run QueryEvidence、AnalysisContext、原plan/contract hash、完整observations和原描述性算法结果。
  按原业务日历展示本期/同期/同比及首尾（不声称连续趋势）；分组按已受验整体同比和百分点贡献展示至多3个最差月、每月至多3个负向贡献类，明确完整组见表。
  缺失/零基数、限制标识和原单位保留，禁止推断币种/因果；格式化仅用于展示，不修改原数值/表/图。
  文本最多6000字符/18000 UTF-8字节；超限失败关闭，不截断或回退自由解释。
- 含封存`PERIOD_COMPARISON_RATE/BOTH_PERIOD_GROUPS`的12月分群面板，其发布布局也采用受验确定性合同，不把模型自由绘图当作能力门槛。
  原完整`observations`表必须保留；Host仅从FULL Oracle已重算的`period_comparison`投影12行整体同比趋势和最多3个整体下降月的全部分组，
  分别成为独立顶层collection、exact-column表与图。一次Publisher必须绑定3表2图：整体同比折线、下降月份分组对比柱图；不得把原48行
  分组面板冒充整体趋势、只发一张混合图、删减分组、重新排名或增加第三张图。Oracle逐项重算result并验证每张表/图及哈希。
  两月ratio rollup没有该同比映射，继续使用原单图合同；选择只依据封存角色/源形状，不按题目文字、列名或测试编号。
- Executor把上述文本作为服务端`final_summary_constraint`交给原一次FINAL调用：当前请求Zod将原`summary_zh`收窄为精确literal，
  该约束进入dispatch task hash，不修改共享registry或外部请求Schema版本。该request-isolated schema由Host固定为`JSON_TEXT`，仍只发
  原一次零工具JSON-mode调用；完整原文必须经`JSON.parse`和同一literal strict schema。模型响应必须逐字匹配；不得后台替换不符的响应。
  新响应在recordExplanation前检查；恢复时原explanation hash通过后仍重验约束，不调用模型改写历史。
  原stage/Oracle/Explanation/Authority链和预算不变；其他合同保持原两字段解释。此模式证明事实展示，不宣称自由语言推理通过。
- V2 Analysis Program候选的条件节点不得重复前序的相同执行。Host只在以下条件全部成立时折叠：节点不是`ALWAYS`；恰好一个
  `dependency_node_id`且同时是activation source；source为`ALWAYS`；criticality相同；method registry IDs、Metric IDs、Dimension IDs、
  两个时间窗、parameters和operator obligations的canonical JSON完全相同；且没有后继依赖或activation引用该节点。折叠后Program budget
  必须按保留节点数重算。不同方法/参数/窗口/义务、非直接依赖、不同criticality和非叶节点必须保留并走原graph/program gate。
  该规则只删除同一计算的冗余重执行，不把`SKIPPED`改写成`SUCCEEDED`，不放宽critical terminal HOLD，也不提交stage或生成业务事实。

## 4. Validation & Error Matrix

| 固定AttributeError消息 | 安全码 / 修复 |
| --- | --- |
| `Can only use .dt accessor with datetimelike values` | `PANDAS_DATETIME_ACCESSOR_REQUIRES_CONVERSION`；显式转换声明日期列 |
| `Can only use .str accessor with string values!` | `PANDAS_STRING_ACCESSOR_REQUIRES_STRING_VALUES`；仅声明字符串列、NULL保留 |
| 未知/带行数据的其他消息 | 不按以上规则投影；保留原有受界identifier策略 |
| NULL 序列被算为完整观测，或排名/极值包含 NULL | 原 `MONTHLY_COMPARISON_ORACLE_RESULT_MISMATCH`，零公开结果；不得恢复已封存失败 |
| `ANALYSIS_RESULT_TABLE_TYPE_UNSUPPORTED` | 只反馈DataFrame或稳定built-in dict rows；只允许一条成功修复Cell后重新发布 |
| 修复Cell后再次请求`python_cell` | 工具不暴露；当前状态只允许`publish_analysis_result` |
| 精确重复的直接条件叶节点 | 编译时删除；budget按剩余节点重算 |
| 重复节点被后继引用，或执行身份任一字段不同 | 不删除；由原DAG gate与Executor处理 |

## 5. Good / Base / Bad Cases

Good：first=null、last=20时只说明首端缺失，整体变化未定义。
Base：first=0、last=20时绝对变化20，相对变化未定义，两个端点均存在。
Bad：根据一个全局限制码写“两端均缺失”，或为了继续运行把坏日期变成NaT。

Good：12 月中 6 个 NULL 先在派生记录里规范化，统计为 observed=6/missing=6；完整 12 行仍保留。
Base：零值计入 observed，端点 NULL 保持 NULL，相邻变化不跨缺口。
Bad：将 `NaN is not None` 当作有效观测，发布时再把 NaN 变成 NULL；JSON 合法不代表统计正确。

Good：`ALWAYS A -> MATERIAL_CHANGE B`中B与A执行身份完全相同且B是叶节点，只编译A。
Base：B使用不同published method或有后继C时，A/B（及C）全部保留。
Bad：把未触发的关键B伪记成功，或仅因method相同就忽略不同时间窗/参数/算子义务。

Good：表symbol被拒后，用一条Cell保留原行/值/NULL/顺序并改为合法容器，随后立即重新发布。
Base：重新发布仍不满足Publisher时按原`PUBLISH_SYMBOL_CONTRACT`预算终止。
Bad：修复Cell成功后继续开放Python，允许重复转换、重算或用timeout掩盖未重新经过Publisher的symbol。

## 6. Tests Required

- 真实NAS Agent image中Arrow DATE32与ISO文本转DataFrame的object dtype；显式转换后日期不变，无网络/数据源写入。
- 月度参考必须用真实 Agent 镜像执行 Arrow→pandas，覆盖 float NaN、nullable Float64/pandas.NA、0、首尾和内部缺失、同值排序、别名/列序及 DATETIME 时区；
  结果逐字段与独立 Oracle 一致，原 DataFrame/列不变、JSON 无非有限值，原 Cell policy 通过。旧 count/extrema 错误即使重新封 hash 仍拒绝。
- 固定错误正例、类型不符/数据后缀负例；provider消息和进度不泄漏raw output；一次repair后原Publisher仍闭合。
- 发布表类型失败时的精确无数据反馈；拒绝后仅Cell、成功修复Cell后仅Publisher，禁止第三条Python旁路；
  修复后错误表仍由原Publisher拒绝，不增加模型/Cell/timeout预算。
- objective投影；非对称NULL、0分母证据不变；原两字段响应、来源货币限制和摘要预算不变。
- focused回归不算真实业务或UI验收；后续按同构建/same Run独立复核。
- 月度完整聚合序列原样保留、跨年/非对称NULL/多个正增长月；错误contract、超12行/超预算仍省略，其他collections不泄漏。
  生产Oracle成功后进入同一FINAL投影；保留原stage hash的离线输入复现不是原自然语言答案修复或新业务PASS。
- 精确文本的接收/拒绝、原不受限协议兼容、非法TOOL约束零调用、per-request registry互不污染、约束改变task hash；
  受约束FINAL固定JSON_TEXT、无约束FINAL仍为Structured Output，且不增加Provider调用、turn、token或恢复预算；
  多月正负/空值/0、别名与时区不改角色、单位不推断、分组排名和百分点贡献、源/contract/Run/数据篡改拒绝。
- 分群同比双图：12行整体趋势、最差月完整分组投影的别名/顺序/NULL；合同固定3表2图；漏图、额外图、错误数据symbol、行筛选、
  图表数据重算、同比排名/贡献篡改和表图哈希不一致均拒绝。无比较映射及两月ratio面板保持原单图回归。
- Analysis Program compiler：精确重复条件叶先RED后GREEN且仅保留前序、budget降为1；不同method的条件节点保留；有后继依赖的精确重复
  条件节点保留；原missing dependency、cycle、unpublished method和operator rewrite拒绝继续通过。

## 7. Wrong vs Correct

Wrong：`observed = [v for v in frame['value'] if v is not None]`，把 pandas NaN 计入观测。
Correct：在派生记录中逐声明数值列先执行 `None if pandas.isna(value) else float(value)`，再按原合同做统计，完整输入行不删。

Wrong：`relative_change=null` → 两个端点都缺失。
Correct：分别读first_value和last_value，说明实际缺失端；若仅摘要省略，不推断源数据状态。

Wrong：Publisher拒绝 → 修复Cell成功 → 仍允许`python_cell | publish_analysis_result`。
Correct：Publisher拒绝 → `CELL_REQUIRED`只允许一条成功修复Cell → `PUBLISH_REQUIRED`只允许原Publisher重验。

Wrong：条件未触发 → 把关键重复节点记为dependency failure → 整个已受验stage终态HOLD。
Correct：只在候选编译阶段删除满足全部结构条件的重复叶；真实条件能力节点仍由Executor按原规则失败关闭。
