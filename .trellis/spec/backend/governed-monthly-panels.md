## Scenario: 完整月度分群描述性方法

### 1. Scope / Trigger

一个已接受 QueryEvidence 含一个 MONTH 时间维度、1–2 个原始分类、1–4 个数值结果，每组完整 2 或 12 月。
叶子、独立 Oracle 与唯一生产 composition 已接线；离线通过不等于真实 Sandbox/模型/浏览器或四层验收。

### 2. Signatures

`compileMonthlyPanelPlan({context,query_evidence_ref,query_evidence_document})` 返回合同、shape 和 Host execution_contract。
method=`published-monthly-group-panel@2`，contract=`monthly-group-panel.result`；原描述性合同编码和月度字段 schema 复用。
原@1只支持12月，历史不重写或回退；@2显式携带由已验收窗口决定的month_count，不接受模型指定窗口长度。
`createMonthlyPanelOracle(context).evaluate(input)` 重验真实 Arrow 和全部 RESULT/TABLE/CHART；仅在唯一 production composition 按完整源形态注册。

### 3. Contracts

- 全部 source/ref/hash/Scope/Run/Context/Release/Schema、原 Metric 公式、CHART_DATASET/applicability 与 groupable 维度重新验证。
- ≤32 个完整分类 tuple、≤384 行、≤16 个第二分类分面，不增加原 LINE 512 行或图表字节限制。实际空分类/时间拒绝，原 nullable 保留。
- observations 稳定按月排序并保留全部原始分类、measure、NULL。每组每月恰一行，每组每 measure 至少有一个真实观测。
- 仅2/12个完整连续月；1/3/11月、半月边界、缺月/重复月拒绝。2月合同最多64行，12月最多384行。
  2月只支持原窗口端点差异，不能声称持续趋势或趋势强度；分类同比排名仍须完整12月。
- 各 measure 字段为 `{groups:[...]}`，按组首次出现顺序存月度描述性结果；不合计/平均比例，不混组，不跨 NULL 比较，不移动原窗口端点。
- `opposed_changes={pairs:[...]}` 只列同组原端点 absolute_change 一正一负的所有有序 measure 对；顺序为组、上升列、下降列的源顺序。
  原始相对变化/NULL 保留，不因负分母下相对变化符号推断升降，也不产生显著性或因果声明。
- chart x=原月、series=第一原分类、facet=第二原分类（存在时）；通过原 Publisher，不能创造复合来源列或删维度。
- execution_contract 仅字段、规则及无数据Python参考实现，不含行或预计算答案；FORMULA/REQUEST_DERIVED 不变为 Metric 或获得统计能力。
  `preparation_reference` 是原固定描述性公式的参考，不由Host执行或作为Oracle期望值；仅原monthly panel方法提供。
  Agent仍返回实际python_cell source，经原AST策略和Sandbox执行、原Publisher/FULL Oracle后才接受；无源代码替换或修复预算放宽。
  显式`source_columns/time_logical_type`与既有时间、分类、measure映射决定准备步骤；time_column原键保存业务日历日期，
  不引入month_str等临时来源列。原DataFrame只读，派生副本转JSON-native NULL，保留完整源列、稳定月序和分类tuple。
  配置仅复制上述字段、month_count和可选period_comparison，不回传大块schema/rules/reference；表从原observations完整投影。
  这证明参考辅助的固定方法执行，不宣称从零自由生成任意分析算法；原statistical_operator义务不受影响。
- 分类同比仅接受本 Run QueryEvidence 中已封存的 `period_comparison` 列角色与 `BOTH_PERIOD_GROUPS`，且原 Metric 可加；
  列名不得替代角色证明，无元数据/仅本期分类范围拒绝，普通比例面板保持原合同。
  额外 `period_comparison` 对象逐月分别合计两期全部分类，任一贡献值 NULL 则该侧整体 NULL；保持源顺序逐项浮点相加。
  总体同比 = 总差额 / 同期总额；仅两侧已知且同期总额 >0 的负同比参与最多3月排名，按同比升序、月份升序。
  每个入选月保留全部组：组差额、来源已证同比、组差额/总体同期额的增速贡献（展示为百分点，非总损失占比）。
  不平均组内比率，不用环比排名，不补零/补齐不足3月，不产生因果解释。
- 上述12月分类同比形态以确定性发布布局替代原始面板折线：原 `monthly_panel` 全量表仍发布；Host 从独立重算的
  `period_comparison` 精确投影12行 `overall_trend_rows` 和最多3个下降月的全部分组 `largest_decline_group_rows`，
  再要求同一次 Publisher 恰好发布3张表与2张图。整体图只绑定12行本期/同期/同比，分组图只绑定下降月完整分组；
  原48行面板不冒充整体趋势，不允许模型选行、重排排名、漏图或增加第三张图。FULL Oracle 逐表逐图从当前 Run Arrow 重算并验 hash。
  该布局仅由封存角色和源形状启用；无同比映射及两月 `ratio_rollup` 继续使用原完整面板单图合同。

- JSON 对象包装让受验统计量沿既有 narrative projection 进入摘要，原始 observations 仍只有计数；8KiB/field、24KiB 总预算不变，超限不伪造摘要。
- 同比对象优先于辅助组统计进入摘要；对象省略不等于来源缺失，也不能从历史答案补算总体拆解。
- 月度算术只在独立 Host Oracle 复用，不共享模型输出作为期望；真实 Arrow/value/source 比对后，完整结果/表/图必须精确相等。
  implementation digest 同时绑定 panel、共享月度 Oracle 模块和公共字节/ref closure；不得遗漏依赖代码或假设源码永远是 `.js`。
- FULL 只覆盖固定描述性事实；`material_change=false`，缺失观测/零分母披露相对变化未定义；无因果或推断性授权。

### 两期分层比例比较（@2）

- 仅2月、2个原分类、唯一request-only `AGGREGATE_RATIO`触发`ratio_rollup`；12月和无该推导的面板不增加此字段。
  分子/分母按已封存operator的Metric ID映射唯一原Metric结果列，且两者可加；缺失/重复来源或非可加Metric拒绝。
  不以列名/题号/关键词、已发布ROAS或旧Run比率猜映射；原来源与适用性重验仍先于本编译。
- 两个原分类轴分别提供上层汇总，不由Host猜哪个叫渠道。每个值/每期按源顺序独立求分子/分母总和后按sealed adjustment相除；
  任一贡献NULL则该侧总和NULL，零分母比率NULL。筛选只在父组：两期分母均正、分母差额>0且比率差额<0。
  保留全部父组及selected标记；仅入选父组展开全部原子tuple，子组不重复套筛选；原表/图完整保留未入选行。
- Python参考接收仅含角色的`ratio_rollup_mapping`，不接受预计算答案；仍原Cell policy/独立Sandbox/Publisher/FULL Oracle。
  Host独立重算完整结构，implementation digest包含分层算术模块；不存在新增发布权威或自由执行路径。
- 原叙述投影优先保留ratio_rollup，8KiB字段/24KiB总预算不扩大；FINAL还需从current-Run源重验映射/全部数值与组集合，
  沿原source-constrained summary输出两期事实、父组入选/未入选和完整子组。6,000字/18,000字节不扩大；超限失败，不裁掉证据。
  原因和建议只作明确待验证的通用假设，不能把两期差异当持续趋势或因果。金额/数值不推断具体币种。
- 必测手算比例均值反例、入选父组含回报上升子组、0/负/NULL分母、空集合、别名/tuple、有限输入溢出；
  生产Oracle重封hash后改父组/删子组/删结果/Arrow漂移均拒绝，FINAL改期间/父组/漏子组拒绝。
  原Agent Python镜像与operator Cell policy须覆盖两月DATE/DATETIME、NULL/零/负/空集合、别名/源序与浮点，独立Host零差异。

### 4. Validation & Error Matrix

来源/能力/维度/公式/单位/粒度/时区漂移 → `MONTHLY_PANEL_AUTHORITY_INVALID`；非法形态或分面上限 → `MONTHLY_PANEL_SHAPE_INVALID`；
空值/非法分类/全空组 measure → `MONTHLY_PANEL_VALUE_INVALID`；缺月/重复月/窗口不符 → `MONTHLY_PANEL_WINDOW_INVALID`。
原来源验证和月度日历错误仍允许传播其既有稳定拒绝码，不以 fallback 放行。
Oracle 内容漂移 → `MONTHLY_PANEL_ORACLE_{RESULT|TABLE|CHART}_MISMATCH`；来源/字节/节点/合同漂移 → 既有 Arrow 拒绝或
`MONTHLY_PANEL_ORACLE_*_INVALID`；有限输入运算溢出仍拒绝 `NUMERIC_RANGE_INVALID`。
同比范围/角色缺失 → `MONTHLY_PANEL_COMPARISON_AUTHORITY_INVALID`；非可加 Metric → 原 authority 拒绝；
独立同比算术非法值或溢出 → `MONTHLY_PANEL_COMPARISON_{VALUE|NUMERIC_RANGE}_INVALID`。
生产方法/skill/contract 必须 exact，缺执行规则或未注册 Oracle 拒绝；不回退其他叶子。

### 5. Good / Base / Bad Cases

Good：月×渠道×客群分别比较投入、收入、请求级净 ROI，保留零分母 NULL。
Base：原两列 single-series 保持统计义务和 Oracle，非时间分类及原月度比较保持原合同/hash。
Bad：把不同客群同月视作一个观测，或把“投入增长/回报下降”自动解释成因果结论。

### 6. Tests Required

DATE/DATETIME、1/2 分类×比例角色、原 nullable/NULL、顺序/别名、含分隔符 tuple、32组/16分面边界；缺/重复月、空分类/时间、
全空组 measure、33组/17分面、额外维度/未知角色，以及原 source/applicability 拒绝。旧描述性合同5个golden hash须不变。
Oracle 正例使用手算期望；重封 hash 的数值/排名/组/NULL/反向变化对/表图漂移和额外因果事实拒绝；真实 Arrow 数值漂移拒绝。
零/负/缺失端点、跨 NULL、有限数值溢出；真实投影保留全表和分面，摘要保留受验统计对象；生产 shape 选择不依赖问题文字。
Schema-valid unit Sandbox receipt 是测试替身，不是生产执行或隔离认证。
Python参考必须另在真实Agent镜像执行并与独立Host Oracle逐字段比较，原operator镜像Cell策略验证；不把Node元数据测试当Python执行证明。
覆盖别名/列序、DATE/DATETIME、1/2分类、同比映射、缺失/零/负基数、无下降和浮点相加顺序，断言原DataFrame不变。
同比手算总体排名（区别于分类均值/环比）、缺失与零/负基数、贡献分母、并列月份与不足3月、有限溢出；
真实 Arrow/生产 Oracle 接线下重封 hash 的总体/排名/贡献/漏组/漏对象/错基准均拒绝；四分类对象在既有摘要预算内保留。
分类同比发布还必须覆盖12行整体集合、下降月完整分组集合、固定3表2图，以及重封后表/图行重排、错误绑定、漏图和额外图拒绝；
无同比映射与两月比例面板须保持原单图回归。

### 7. Wrong vs Correct

Wrong：用 `channel` 分组后忽略 `audience`，或用每组首个非空值替换原窗口起点。
Correct：以完整原分类 tuple 分组，要求原窗口12月完整，缺失端点的变化保持 NULL。

新增两月窗口必须覆盖DATE/DATETIME、缺月/重复月/半月/错误长度、无关键词生产注册，以及实际Python与独立Host结果精确相等。
两月支持本身不实现“先渠道筛选再拆人群”；同tuple反向变化对不能冒充跨tuple的上层汇总或比例重算。
