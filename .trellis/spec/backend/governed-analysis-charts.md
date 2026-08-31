# 受治理分析图表

沿用原 QueryEvidence、Oracle 与原子 Publisher 权威；本文只定义完整来源投影与确定性展示。

## Scenario: 原始分类分面的受治理图表

### 1. Scope / Trigger

月×分类×第二分类不能省维度或编造复合源列。V3 projection新增可选`facet_key`，只提供确定性视图分区，不新增数据/统计授权。

### 2. Signatures

`ArtifactWorkspaceChartProjectionV3.facet_key?: columnKey`；显式分面需`derived-analysis-chart@1.2.0`。
`computeArtifactWorkspaceChartDatasetV3Hash`仅存在该字段时加入hash；`toGovernedVChartPanels`按原始分类值再按measure分图。

### 3. Contracts

- 仅LINE/BAR/HORIZONTAL_BAR，字段为原表STRING列，不能与x/y/series重叠；实际非空、每值≤256字符、最多16个分面。
- 每分面每measure至少一个真实观测，其余NULL保留；原全表/行序/值不改，现有全表行数和512KiB上限不增加。
- 原series字段在分面内不变，measure独立纵轴。分面顺序按源值首次出现，分面内保留原行序；JSON tuple仅作UI key，不写源数据。
- 完整原表仍为document/preview/hash的唯一数据，分图只是视图。旧1.0/1.1拒绝facet，新字段缺省时旧hash不变。
- 本项为读取/渲染契约；生产publisher接线及具体方法必须另经来源/独立oracle验证，不能由前端构造权限。

### 4. Validation & Error Matrix

旧版本带facet → `CHART_V3_FACET_TRANSFORM_REQUIRED`；错误列/重叠/图类 → `CHART_V3_FACET_BINDING_INVALID`；
NULL/空值 → `CHART_V3_FACET_VALUE_INVALID`；超16组 → `CHART_V3_FACET_LIMIT_EXCEEDED`；某分面整measure无观测 →
`CHART_V3_FACET_MEASURE_HAS_NO_OBSERVATIONS`。换facet/换group沿用旧hash拒绝；跳过分图直接render → `VCHART_FACETS_REQUIRE_PANELS`。

### 5. Good / Base / Bad Cases

Good：x=月份、series=渠道、facet=客群，逐measure分图且金额/比例不同轴。
Base：无facet的旧图仍走原路径，旧非空golden hash保持。
Bad：series只保留渠道，将不同客群的同月值连成一条线，或拼接值替换原列。

### 6. Tests Required

3图类seal/verify/preview、旧版本拒绝、错列/数值/重叠/空值/分面上限/全空measure、换维/分类后的hash失败；
源表与NULL不变、含分隔符的分类、每原行在每measure恰好一个分面、分图标签/独立轴与初始PENDING。静态组件不是浏览器验收。

### 7. Wrong vs Correct

Wrong：`row.series = row.channel + "|" + row.audience`。
Correct：`{ x_key: "month", series_key: "channel", facet_key: "audience" }`，完整原表封hash，UI只分区显示。
