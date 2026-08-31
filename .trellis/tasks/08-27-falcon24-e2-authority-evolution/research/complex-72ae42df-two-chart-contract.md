# 72ae42df A3 双图发布合同复盘

## 现场事实

- fresh scratch `data-agent-falcon24-e17-72ae42df` 与 attested Web/Worker 绑定同一 clean commit。
- A1 `de62c22d-680d-8c39-a43a-43ac4a0e795f` 与 A2 `027edf1e-0da3-8a54-9461-8e61422a6b1a` 的业务 Oracle、QA/Trace 均通过。
- A2 首次 Publisher 返回 `ANALYSIS_RESULT_TABLE_TYPE_UNSUPPORTED`；修复 Cell 成功后 Host 只允许重新发布，Run 成功，证明 `72ae42df` 的发布修复状态机真实生效。
- A3 `ad2b76fa-857a-870f-ac75-afe51b672a7f` 同样经一次表类型修复后成功发布，Semantic、Text2SQL、Analysis、48 行分组来源、整体同比排名和 stage 结果均通过独立复核。
- A3 业务复核仍为 `COMPLEX_A3_REQUIRED_TWO_CHARTS_MISSING`：只发布一张 `monthly_panel_line` 单面板分组折线图；没有保留整体同比趋势图，也没有单独增加最差月份客户类型对比图。原 Run 不重放、不改写。

## 根因

`compileMonthlyPanelPlan` 只根据受验源形状生成一张 `monthly_panel_line` 图。虽然 `period_comparison` 已由 Host FULL Oracle 独立计算出 12 个月整体同比和最多 3 个最差月份的完整分组，但这些结构化事实没有进入独立表/图合同。模型任务文字要求两张图，Publisher 的唯一权威合同却只允许一张图，因此模型无法合法交付两张图。

## 前向修复

- 仍只按封存 `PERIOD_COMPARISON_RATE`、`BOTH_PERIOD_GROUPS` 和完整月度分群源形状启用，不读取问题关键词、列名猜测或验收题编号。
- 从原独立 `period_comparison` 确定性投影两个顶层集合：
  - `overall_trend_rows`：12 行 `period/current_value/comparison_value/yoy_rate`；
  - `largest_decline_group_rows`：最多 3 个整体下降月的全部分组，保留本期、同期、组同比和整体同比贡献。
- 原 `monthly_panel` 48 行表继续发布作为完整源身份；新增两张派生表和两张必需图：整体同比折线图、下降月份分组对比柱图。原始面板不再生成含混的单图。
- Python preparation reference 只给无数据算法；模型仍需在真实 Cell 中形成 exact-column symbols，并在一次 `publish_analysis_result` 中绑定 3 表 2 图。
- FULL Oracle 从当前 Run 原 QueryEvidence 重算结构化结果，逐项验证 result、3 张表、2 张图及其哈希。任何漏图、额外图、行筛选、重新排名、贡献改写或表/图绑定错误均失败关闭。

## 边界

- 两期净 ROI 分层面板没有 `period_comparison`，继续使用原单图合同；本修复不改变 B3 比例汇总、筛选或子组算法。
- 不新增模型调用、repair/timeout 预算、SQL 权限、数据源访问或发布权威；不把模型自由绘图当作证明。
- 单测/Oracle 通过不是新业务 PASS；必须新 clean build、fresh scratch，从 A1 开始重跑 A/B 六题，禁止拼接本构建 A1/A2。

## 证据

- 私有审计：`/Users/lienli/.codex/audit/falcon24-e1-authority-reset/complex-72ae42df/turn-01..03`。
- A3 `terminal-observation.json`、`intent-binding.json`、`stage-evidence.json`、`oracle-grouped-yoy.json`、`business-review.json` 保留原成功终态与业务失败。
- 初始 RED：双图投影函数不存在、合同缺两个集合/两表/两图；实现后月度比较、规划、Oracle、发布器和模型参数注入 focused suites 转绿。
- 7 个 focused 文件 165 项、Worker typecheck/build、Biome、Trellis validate、`git diff --check` 通过；其中四项专门重排两张派生表与两张图的已重哈希内容，FULL Oracle 均按目标类型失败关闭。
- NAS 原 Agent image Python 3.12 与原 Operator Cell policy 对 22 种输入通过；含别名/乱序/NULL/0/负基数/无下降/浮点及两月回归，
  与独立 Host Oracle 逐字段 0 差异，protected DataFrame 不变，网络关闭、模型调用 0、authority 写入 0。
