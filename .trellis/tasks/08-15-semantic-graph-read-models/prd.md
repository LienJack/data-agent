# 语义图读取模型与全图聚类 PRD

## Goal

为 Node List、局部图、全图、Agent 读取和 Graph Diff 提供同一份 release/candidate Node/Edge
读取模型，并在大图中用授权安全、可重建的 community hierarchy 实现分层浏览。

## Scope

- Node List/detail、1/2-hop、shortest path、impact/diff API。
- 发布图 + candidate overlay 的统一 identity/status projection。
- release-bound community/layout projection、rebuild 和降级。
- PostgreSQL revalidation、Neo4j/index 可选加速与规模预算。

## Requirements

- 四个读取面必须返回一致 Node/Edge identity、方向、类型和候选状态。
- Local graph 默认 1-hop、可扩 2-hop，强制 250 Node/500 Edge 并显式报告截断。
- Full graph 首屏返回 cluster hierarchy；任一层最多 500 glyph，不全量塞入 DOM/API。
- community 只用于导航/检索，不创建或修改发布语义。
- Candidate overlay 不在每次 mutation 后重算全图，先挂接稳定 cluster/候选 cluster。
- 所有 Node、Edge、path、聚合计数均使用相同权限过滤；索引结果由 PostgreSQL hydrate。
- 图索引/community 失败时可降级，不能阻断 Authority、审核或 Query Runtime。

## Out of Scope

- Agent mutation、前端 WebGL 渲染、LLM 自动发布 community、把 Neo4j 变为 Authority。

## Acceptance Criteria

- [ ] List/local/full/diff consistency fixture 对同一 revision 结果完全一致。
- [ ] 250/500/500 预算、continuation 和 aggregation 在边界值测试中生效。
- [ ] 10,000 Node fixture 首屏只返回可操作 cluster 摘要并满足性能预算。
- [ ] community 对相同 release/algorithm/seed 可确定性重建并匹配 digest。
- [ ] 不可见对象不出现在 path、cluster count、truncation count 或 Agent read 结果中。
- [ ] Neo4j/community unavailable 时 PostgreSQL list/local 与表格 fallback 仍可用。
