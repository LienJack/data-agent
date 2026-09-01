# 2217ff9c B3 完整面板先行复盘

## 冻结现场

- commit：`2217ff9c98712244842f8527ad93eca5c363d40d`
- scratch：`falcon24-e17-2217ff9c`，本地只经 `55525` 访问
- A1/A2/A3/B1/B2：同一 build/scratch 连续完成独立业务、QA/Trace 与刷新
- B3：Run `54be4db1-e8b2-8485-a1e3-6333d3607f36`，FAILED，未重提

B3 共 74 个事件。Semantic 专职 Agent 已接受当前 Run 的 `SemanticQueryContext`，其 exact projection 同时包含营销月份、渠道、目标人群、
营销投入、营销归因收入、`RECENT_COMPLETE_PERIODS(2)` 与 `AGGREGATE_RATIO(SUBTRACT_DENOMINATOR, SUM_BEFORE_RATIO, NULL)`。
因此发布 release、物理 binding、请求级公式和窗口闭包均已成立。

随后 Root 三次委派 Text2SQL，每个 task 各有两个 bounded candidate。六个候选分别以
`TEXT2SQL_REQUEST_TIME_WINDOW_MISMATCH`、`QUERY_EVIDENCE_REQUEST_DERIVATION_BINDING_INVALID`、
`TEXT2SQL_RATIO_QUERY_SHAPE_REJECTED`、`TEXT2SQL_RATIO_GROUP_REJECTED` 失败关闭，未产生 SqlArtifact/QueryEvidence，最终 Run 以
`ROOT_AGENT_TURN_BUDGET_EXHAUSTED` 结束。诊断只读取 safe reason code、Profile/task/ref 与公开事件摘要，没有读取 Provider 原文、objective、
SQL、参数值或 Secret。

## 契约断点

`provePostgresqlAggregateRatio` 已支持任意数量的已选直接 Dimension，并能在 exact complete-month window 内验证月份、渠道和目标人群的
完整分组；其安全子集同时明确禁止 CTE、JOIN、额外 filter、HAVING 和 SQL 内预筛。`4.0.0` B3 把“先筛渠道、再拆人群”写在事实要求中，
使模型把业务展示顺序实现成 SQL 内筛选，候选因此在 query shape、group、binding 或 window 校验间漂移。这不是证明器缺能力，也不应通过
放宽 SQL 防火墙解决。

## 前向边界

`complex-l4-semantic-defined@4.1.0` 保留双月、渠道、目标人群、营销投入、营销归因收入与请求级净 ROI，只明确：

1. Semantic 解析并冻结全部对象与两个 request-scoped operators；
2. Text2SQL 先输出完整 `month × channel × audience` 两月事实面板和图，不在 SQL 内筛选；
3. Root 仅在 accepted 当前 Run QueryEvidence 后按渠道重新汇总、筛选，再展示入选渠道的全部人群；
4. 父渠道净 ROI 必须从父级收入/投入先汇总后相除，不能平均子组净 ROI；空集合如实报告。

旧 `4.0.0`、失败 Run 与 candidate hash 不改写。这个 docs/profile 版本不增加模型调用、repair、权限、Formula、publisher 或 Host SQL，
也不降低 source/business Oracle、图、history binding、同 Run QA/Trace 与 live E16 零漂移要求。scoped commit 后必须关闭旧现场，
用新 clean build/fresh physical scratch 从 A1 重跑六题；`2217ff9c` 的五个 PASS 不能拼接。

## 安全收口

live after audit 对 348 张表逐表重算 fingerprint，和 `complex-2217ff9c-before.json` 完全一致，authority epoch 仍为 E16。
Worker 停机前 build 为 `sha256:74fc00dd94cfac692791680578522d74a86d453bc9dbded55e56c3d41a9e96ad` 且最后周期 `IDLE`。
两个本轮 browser/auth、Web/Worker、55525 SSH forward 与 scratch container 已精确关闭；
`data-agent-falcon24-e17-2217ff9c-pgdata` 仅作为停止的 checkpoint 保留。普通 NAS PostgreSQL/Neo4j healthy，OrbStack 未启动。
