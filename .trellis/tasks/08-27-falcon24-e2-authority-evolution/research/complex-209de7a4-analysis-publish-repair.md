# 复杂 A3 Analysis 发布修复闭包

## 现场证据

- clean build `209de7a4` 的 A1、A2、B1 已分别完成独立来源 Oracle、业务复核与同 Run QA/Trace。
- A3 Run `a8a5610b-f301-8b57-a567-825efe1cced6` 的 Semantic 与 Text2SQL 均完成，当前 Run 保留了 48 行分组同比 `QueryEvidence`；Analysis 节点随后失败。
- Analysis 首个 Python Cell 成功，首次 `publish_analysis_result` 以 `ANALYSIS_RESULT_TABLE_TYPE_UNSUPPORTED` 拒绝；模型提交的修复 Cell 也成功。
- 修复 Cell 成功后，Host 仍同时提供 `python_cell` 与 `publish_analysis_result`。模型再次选择 Python Cell；该 Cell 超时，Context 对既有成功 Cell 的恢复重放也未完成，最终节点为 `ANALYSIS_SANDBOX_CELL_TIMEOUT`，Run 保留 `FALCON24_ANALYSIS_PUBLICATION_TERMINAL_HOLD`。
- 失败没有生成 AnalysisReport、Chart 或 Stage，也没有被重新提交、重放或改写为 PASS。

## 根因分类

- 类型：跨层协议状态缺口与集成覆盖缺口。
- 首次表类型拒绝本身是正确的 Publisher 防线；缺口位于单次发布修复预算的状态机：一次修复 Cell 成功后还允许继续生成任意 Python，而不是要求使用已修复 symbol 重新走同一 Publisher。
- 通用“修复引用的 symbol”反馈没有明确表 symbol 的合法容器类型，增加了模型重复转换的概率。

## 最小修复

- 发布拒绝后进入 `CELL_REQUIRED`：只暴露 `python_cell`。
- 第一条成功修复 Cell 后进入 `PUBLISH_REQUIRED`：只暴露 `publish_analysis_result`，要求立即使用相同修复绑定重新发布。
- 为 `ANALYSIS_RESULT_TABLE_TYPE_UNSUPPORTED` 提供无数据的精确反馈：允许 exact-column DataFrame 或非空 built-in list of built-in dict rows，要求保持行、值、NULL 和顺序，不重算分析。

## 未改变边界

- 不增加模型、Cell、repair、timeout 或 Root turn 预算。
- 不降低 Publisher、Oracle、类型、表列、chart、来源或 stage 校验。
- 不复用或重放失败 A3；修复提交后必须用新 clean build 和 fresh scratch 从头验证。
- 当前记录不是复杂预检 PASS，更不是正式十五题或 production-isolation PASS。
