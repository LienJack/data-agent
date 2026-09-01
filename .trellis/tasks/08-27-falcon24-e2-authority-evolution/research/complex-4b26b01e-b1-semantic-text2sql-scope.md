# 4b26b01e B1 Semantic + Text2SQL 事实闭包复盘

## 冻结现场

- commit：`4b26b01e03fff16e8ee96b8dcccaa256561b7576`
- scratch：`falcon24-e17-4b26b01e`，本地只经 `55521` 访问
- A1/A2/A3：独立业务与同 Run QA/Trace PASS，73/76/76 节点
- B1：Run `cf4a62f5-046c-8641-91a1-2d4392fb7d5f`，FAILED，未重提

B1 四个 Root native call 依次为 Semantic、Semantic、Semantic、Text2SQL；前两次 Semantic 在受治理 catalog tool 中失败，第三次接受
SemanticQueryContext。第四次 Text2SQL 消费该 exact Context，提交 SqlArtifact、4 行 QueryEvidence 和渠道图，但输出用途为
`CONTINUATION_INPUT`；Root 四回合耗尽，答案为空，没有 Analysis 或最终验收。

独立物理源 Oracle 重新聚合 App、Email、SMS、Social Media，证明每个渠道的营销投入、营销归因收入和 ROAS 与 QueryEvidence 完全一致。
冻结检索也选中了 `dimension.marketing_channel`、`formula.marketing_spend`、`formula.marketing_revenue`、`formula.marketing_roas` 及对应 Metric。
因此不是 Semantic/Text2SQL 数据能力、公式、SQL 或图表错误，而是非计分预检仍要求 Root 自行推断是否需要额外 Analysis，浪费了终结回合。

诊断只读取 ProviderResponse 的 tool/profile/input/output 类型和 hash、公开 team task 状态、Run reason code；没有公开模型 objective、原始响应
或 Secret。live E16 before/after 348 表完全一致；临时 Web/Worker/browser/55521 已关闭，scratch volume 保留，Sandbox residual 为 0。

## 下一版题面

按用户明确授权，`complex-l4-semantic-defined@4.0.0` 的 B 组三题直接锚定 active generation 2 已有的发布术语/公式与请求级 operator，
要求动态 Semantic→Text2SQL 完成当前 Run 的事实表和图；删除未请求的额外统计分析、原因推断和建议。B3仍保留双月、渠道筛选、目标人群
分组和请求级净 ROI，不能由 Host 填 SQL、ID 或答案。

这不是新语义发布：ROAS继续使用 `formula.marketing_roas` 的 active AST；净 ROI 继续由 Semantic 形成 REQUEST_ONLY/NONE 的
AGGREGATE_RATIO，Text2SQL 以 REQUEST_DERIVED 输出。来源、窗口、公式、分组、Oracle、一次提交、history binding、同 Run QA/Trace 和
live authority 标准不变。完成 docs commit 后必须用新 clean build/fresh物理scratch从 A1 重跑六题，旧 A 组三个 PASS 不拼入。
