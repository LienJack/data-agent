# 语义图读取与聚类设计

## Unified Projection

读取服务以 `release graph projection + ordered candidate patches` 生成统一视图，Node List、Local、
Full、Diff 和 Agent tools 共享 identity/status contract。Server 返回 projection/candidate revision 和
consistency token，避免不同页面各自派生关系。

## APIs

- paginated node list/detail；
- edge detail；
- bounded neighborhood with family/direction/continuation；
- shortest visible path；
- impact/lineage/candidate diff；
- cluster hierarchy and level expansion。

## Community

发布流水线先按 domain 分区，再把异构图投影为无向加权 simple graph，使用 seeded Graphology
Louvain `detailed` dendrogram 计算 content-addressed hierarchy。Projection 绑定 family weight map、
resolution、algorithm version、stable seed 和 member digest。Candidate overlay 附着发布 cluster
或独立 candidate cluster，正式发布后再异步重建。Cluster 摘要首版只用确定性 counts/top hubs；
LLM 文本不参与 membership 或 Authority。

## Authority and Security

PostgreSQL 保存 projection identity 并执行 scope/visibility hydration。Neo4j 只提供 candidate keys，
不可见 key 被丢弃且不计入聚合。projection 可由 source release 重建。

## Degradation

community/Neo4j 失败时返回 PostgreSQL Node List、bounded local graph 和无布局表格；标记 degraded
但不伪造空图，不影响 Query Runtime。
