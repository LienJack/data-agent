## Scenario: 完整月度分群描述性方法

### 1. Scope / Trigger

一个已接受 QueryEvidence 含一个 MONTH 时间维度、1–2 个原始分类、1–4 个数值结果，每组完整 12 月。
叶子、独立 Oracle 与唯一生产 composition 已接线；离线通过不等于真实 Sandbox/模型/浏览器或四层验收。

### 2. Signatures

`compileMonthlyPanelPlan({context,query_evidence_ref,query_evidence_document})` 返回合同、shape 和 Host execution_contract。
method=`published-monthly-group-panel@1`，contract=`monthly-group-panel.result`；原描述性合同编码和月度字段 schema 复用。
`createMonthlyPanelOracle(context).evaluate(input)` 重验真实 Arrow 和全部 RESULT/TABLE/CHART；仅在唯一 production composition 按完整源形态注册。

### 3. Contracts

- 全部 source/ref/hash/Scope/Run/Context/Release/Schema、原 Metric 公式、CHART_DATASET/applicability 与 groupable 维度重新验证。
- ≤32 个完整分类 tuple、≤384 行、≤16 个第二分类分面，不增加原 LINE 512 行或图表字节限制。实际空分类/时间拒绝，原 nullable 保留。
- observations 稳定按月排序并保留全部原始分类、measure、NULL。每组每月恰一行，每组每 measure 至少有一个真实观测。
- 各 measure 字段为 `{groups:[...]}`，按组首次出现顺序存月度描述性结果；不合计/平均比例，不混组，不跨 NULL 比较，不移动原窗口端点。
- `opposed_changes={pairs:[...]}` 只列同组原端点 absolute_change 一正一负的所有有序 measure 对；顺序为组、上升列、下降列的源顺序。
  原始相对变化/NULL 保留，不因负分母下相对变化符号推断升降，也不产生显著性或因果声明。
- chart x=原月、series=第一原分类、facet=第二原分类（存在时）；通过原 Publisher，不能创造复合来源列或删维度。
- execution_contract 仅字段/规则，不含行或预计算答案；FORMULA/REQUEST_DERIVED 不变为 Metric 或获得统计能力。

- JSON 对象包装让受验统计量沿既有 narrative projection 进入摘要，原始 observations 仍只有计数；8KiB/field、24KiB 总预算不变，超限不伪造摘要。
- 月度算术只在独立 Host Oracle 复用，不共享模型输出作为期望；真实 Arrow/value/source 比对后，完整结果/表/图必须精确相等。
  implementation digest 同时绑定 panel、共享月度 Oracle 模块和公共字节/ref closure；不得遗漏依赖代码或假设源码永远是 `.js`。
- FULL 只覆盖固定描述性事实；`material_change=false`，缺失观测/零分母披露相对变化未定义；无因果或推断性授权。

### 4. Validation & Error Matrix

来源/能力/维度/公式/单位/粒度/时区漂移 → `MONTHLY_PANEL_AUTHORITY_INVALID`；非法形态或分面上限 → `MONTHLY_PANEL_SHAPE_INVALID`；
空值/非法分类/全空组 measure → `MONTHLY_PANEL_VALUE_INVALID`；缺月/重复月/窗口不符 → `MONTHLY_PANEL_WINDOW_INVALID`。
原来源验证和月度日历错误仍允许传播其既有稳定拒绝码，不以 fallback 放行。
Oracle 内容漂移 → `MONTHLY_PANEL_ORACLE_{RESULT|TABLE|CHART}_MISMATCH`；来源/字节/节点/合同漂移 → 既有 Arrow 拒绝或
`MONTHLY_PANEL_ORACLE_*_INVALID`；有限输入运算溢出仍拒绝 `NUMERIC_RANGE_INVALID`。
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

### 7. Wrong vs Correct

Wrong：用 `channel` 分组后忽略 `audience`，或用每组首个非空值替换原窗口起点。
Correct：以完整原分类 tuple 分组，要求原窗口12月完整，缺失端点的变化保持 NULL。
