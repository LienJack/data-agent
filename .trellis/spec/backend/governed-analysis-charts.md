# 受治理分析图表

沿用原 QueryEvidence、Oracle 与原子 Publisher 权威；本文只定义完整来源投影与确定性展示。

## Scenario: 原始分类分面的受治理图表

### 1. Scope / Trigger

月×分类×第二分类不能省维度或编造复合源列。V3 projection新增可选`facet_key`，只提供确定性视图分区，不新增数据/统计授权。

### 2. Signatures

`ArtifactWorkspaceChartProjectionV3.facet_key?: columnKey`；显式分面需`derived-analysis-chart@1.2.0`。
`computeArtifactWorkspaceChartDatasetV3Hash`仅存在该字段时加入hash；`toGovernedVChartPanels`按原始分类值再按measure分图。
Publish model binding可选`facet_field`；Host按是否存在该字段选择`analysis-result-publish-tool@1.0.0|1.1.0`，模型仍不能指定版本/intent/template。
原publisher输出对应`analysis-published-chart@1.0.0|1.1.0`；Worker read-back与Trace共用`refineAnalysisPublishedChartFacet`。

### 3. Contracts

- 仅LINE/BAR/HORIZONTAL_BAR，字段为原表STRING列，不能与x/y/series重叠；实际非空、每值≤256字符、最多16个分面。
- 每分面每measure至少一个真实观测，其余NULL保留；原全表/行序/值不改，现有全表行数和512KiB上限不增加。
- 原series字段在分面内不变，measure独立纵轴。分面顺序按源值首次出现，分面内保留原行序；JSON tuple仅作UI key，不写源数据。
- 完整原表仍为document/preview/hash的唯一数据，分图只是视图。旧1.0/1.1拒绝facet，新字段缺省时旧hash不变。
- 分面必须指向原ResultContract表的STRING/DIMENSION，template限定原line.multi-series/bar.grouped/bar.stacked；不可与x/y/series重叠。
  publish1.1必须至少一个facet，单个chart1.1必须恰有facet；旧版带新字段和新版无分面均拒绝。工具manifest升级1.1，旧输入不注入新字段。
- Provider-facing model/authority chart binding 用两个 closed/all-required object 分支表达有无facet，不能直接加入 optional property。
  DeepSeek Strict 原投影仍拒 optional/null/open object；两个分支复用原字段/refinement，不增加空字符串或NULL哨兵，也不改旧输入bytes。
- 同一publisher保留完整原表，不因facet改RESULT/TABLE字节。manifest/chart/closure hash绑定该字段；Worker投影facet_key，assemble选择transform1.2。
  Trace继续原READ事务、canonical bytes/raw hash/metadata/Scope/Run验证，新增版本不是绕过列身份的理由。
- 新发布格式不等于新方法能力；原月度/分类oracle继续要求原精确图合同，不能擅自加facet。月份×分类方法仍须独立来源与oracle验证。

### 4. Validation & Error Matrix

旧版本带facet → `CHART_V3_FACET_TRANSFORM_REQUIRED`；错误列/重叠/图类 → `CHART_V3_FACET_BINDING_INVALID`；
NULL/空值 → `CHART_V3_FACET_VALUE_INVALID`；超16组 → `CHART_V3_FACET_LIMIT_EXCEEDED`；某分面整measure无观测 →
`CHART_V3_FACET_MEASURE_HAS_NO_OBSERVATIONS`。换facet/换group沿用旧hash拒绝；跳过分图直接render → `VCHART_FACETS_REQUIRE_PANELS`。
Publish/Chart版本错配 → `ANALYSIS_RESULT_PUBLISH_FACET_VERSION_INVALID`/`ANALYSIS_CHART_FACET_VERSION_INVALID`；字段相撞 →
`ANALYSIS_CHART_FACET_BINDING_INVALID`；原publisher缺列/非分类 → `ANALYSIS_RESULT_CHART_FIELD_BINDING_INVALID`；读回缺原分类 →
`ANALYSIS_CHART_FACET_SOURCE_INVALID`，Trace对外仍`RESOLUTION_TRACE_ARTIFACT_CORRUPT`，不泄露数据。

### 5. Good / Base / Bad Cases

Good：x=月份、series=渠道、facet=客群，逐measure分图且金额/比例不同轴。
Base：无facet的旧图仍走原路径，旧非空golden hash保持。
Bad：series只保留渠道，将不同客群的同月值连成一条线，或拼接值替换原列。

### 6. Tests Required

3图类seal/verify/preview、旧版本拒绝、错列/数值/重叠/空值/分面上限/全空measure、换维/分类后的hash失败；
源表与NULL不变、含分隔符的分类、每原行在每measure恰好一个分面、分图标签/独立轴与初始PENDING。静态组件不是浏览器验收。
模型到Host版本选择、真实Arrow到原publisher到V3的完整行/NULL、无facet时原RESULT/TABLE/旧图不变；重封hash仍拒绝错版本/缺列/非DIMENSION。
Trace新增chart1.1与原1.0读取、原scope/bytes/canonical/ref拒绝；原方法擅加facet仍被独立oracle拒绝。publisher unit的空JSON measure仅测暂存，不能称oracle PASS。
DeepSeek Strict必须对真实model和authority两份Zod schema做投影回归；两种chart分支各自required覆盖全部properties，保留原可选/null拒绝测试。

### 7. Wrong vs Correct

Wrong：`row.series = row.channel + "|" + row.audience`。
Correct：`{ x_key: "month", series_key: "channel", facet_key: "audience" }`，完整原表封hash，UI只分区显示。

## QueryEvidence 自动 V2 图的唯一横轴边界

`buildQueryEvidenceChartDocument` 仍返回原 V2 图或 null；V2 没有 series/category 身份。
从已验证 QueryEvidence 投影后若 x 值重复，TREND/COMPARISON/COMPOSITION 均不生成自动图。
不合并、取均值、去重、改数值或拼接分类来伪造唯一 x；保留完整 QueryEvidence，交原有按角色
映射的 Analysis/V3 生产者作图。已有唯一 x 的图及其hash、空值、排序/数量边界不变。

Text2SQL 的 TABLE/NONE presentation 仍可能经既有自动选图逻辑，故仅依赖模型填 TABLE 不足以保护
分群数据；唯一 x 防线必须位于共用图投影函数。此处 null 是“不生成不适配的附加图”，不是隐藏
查询错误或完成用户图表要求；业务需图时仍须取得正确图后验收，不能把空图当图表 PASS。

回归覆盖三个 intent 的月×分类重复 x、原证据不变、原唯一 x 的 LINE/BAR/PIE、多measure及NULL。
离线对真实48行证据检查自动图为null可证明投影修复，不能改写旧Run错误图或代替新Run验收。
