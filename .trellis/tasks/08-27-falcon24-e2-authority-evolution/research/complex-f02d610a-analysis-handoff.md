# f02d610a Analysis 交接复盘

## 冻结结果

- commit：`f02d610a7b66a10fe761c94a7cc9a138c8394761`
- scratch：`falcon24-e17-f02d610a`，本地只经 `55526` 访问
- A1、B1、B2：独立 source/business Oracle 与同 Run QA/Trace PASS
- A2：Run `32110f83-ac3a-8594-b38e-014537158d9e`，产品终态 SUCCEEDED，但 gate FAIL
- B3：Run `807a1d26-29c5-888e-98ce-627283a72780`，事实与 Stage PASS，但 `4.1.0` 叙事合同 FAIL

A2 的当前 Run SemanticQueryContext、SqlArtifact 和 48 行 `month × customer_type` QueryEvidence 完整。独立源重组确认每组本期/同期值与同比、
整体同比和下降最大的 2024-08/09/10 均正确；Root 随后直接基于表格回答，没有创建 Analysis Stage、AnalysisReport 或两张确定性图。
这不是 Analysis 能力失败，而是问题没有把专职 Agent 交接写成必需动作。

B3 的 32 行 `month × channel × audience` QueryEvidence 覆盖两个完整自然月、四渠道和四类人群。独立源 Oracle 以及从受验方法输入重新计算的
Stage result 均零差异：渠道层唯一入选 `SMS`，其全部四类人群都保留。Analysis 还按第二个分类轴报告空筛选，并把可能原因/下一步明确标为
待验证假设。该输出符合受验 `ratio_rollup` 方法的描述性边界，但和 `4.1.0` 的绝对禁止文案不一致；当前 Run 不做浏览器验收，也不改写为 PASS。

## 前向合同

`complex-l4-semantic-defined@4.2.0` 让能力交接显式、事实门槛不变：

1. A2 必须由 Semantic 冻结同比窗口与客户类型，Text2SQL 返回完整 48 行面板，再由 Analysis 计算整体排名、分组贡献并发布两张必需图；
2. B3 必须由 Semantic 冻结双月与请求级净 ROI，Text2SQL 返回完整 32 行面板，再由 Analysis 做父渠道 SUM-before-ratio 筛选和子组展示；
3. B3 允许受验方法附带其他分类轴结果及明确标注的待验证假设，但禁止因果、持续趋势和确定性建议；
4. B1/B2 保持 Semantic/Text2SQL 事实短链，不为统一形态强制 Analysis。

没有修改生产代码、active generation 2、公式、SQL proof、Host 方法、Publisher、repair、权限或调用预算。旧 profile、Run、Stage 和 Artifact
全部保持不可变。完成 scoped docs commit 后必须审计/关闭本现场，并在新 clean build/fresh physical scratch 从 A1 重跑六题；本轮任何 PASS
或部分事实都不能拼入下一 epoch。
