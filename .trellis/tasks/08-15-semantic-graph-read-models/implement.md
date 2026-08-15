# 语义图读取与聚类执行计划

1. 冻结 list/detail/neighborhood/path/impact/diff/cluster contracts 和 consistency token。
2. 实现 release + candidate overlay projection resolver 与统一 authorization hydration。
3. 扩展 relationship index 到 Graph v2 local/path read，加入 250/500 budget/continuation。
4. 实现 domain-first + seeded Louvain dendrogram community hierarchy、family weight receipt、digest、
   rebuild/compare/health。
5. 实现 full graph level expansion 与 500 glyph budget。
6. 增加 10k benchmark、scope leakage、projection consistency、index failure degradation 测试。
7. 运行验证、scoped commit 并归档 child。

```bash
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/semantic typecheck
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/platform test:unit
```

Go/No-Go：identity/status 不一致、聚合泄漏不可见对象、预算可绕过或 projection 无法重建时不开放
前端 Full Graph。
# 实施计划

## 1. 统一读取合同

- 定义发布图与候选 overlay 共享的 Node/Edge 状态、列表、详情、邻域、影响分析和全图分群 DTO。
- 所有视图返回同一 `consistency_token`，禁止页面自行推导第二套 identity。

## 2. 确定性读取模型

- 从发布 `SemanticGraphProjection@1` 与可选候选投影构建 normalized snapshot。
- 实现筛选分页、1/2-hop 预算与显式截断、影响分析、最短路径。
- 按业务 domain 与物理 schema 生成稳定 cluster hierarchy、hub 和布局坐标。

## 3. 边界与规模验证

- 覆盖发布/新增/修改/退役状态一致性。
- 覆盖 250 Node、500 Edge、500 glyph 预算和 continuation。
- 使用 10,000 Node fixture 证明全图首屏只返回 cluster 摘要。

## 完成证据

- 新增 `SemanticGraphRead@1` 合同：统一状态、列表、邻域、路径、影响和全图分群 DTO。
- `createSemanticGraphReadModel` 对发布投影与候选 overlay 生成同一 `consistency_token`，所有视图共享 identity/status/relation count。
- 局部图实现 1/2-hop、方向/关系家族筛选、250 Node/500 Edge 上限、continuation 与显式 omitted count。
- 全图按业务 domain 和物理 schema 生成确定性 cluster、hub、布局与 hierarchy digest；展开层最多 500 glyph。
- `projectSemanticGraphSourceForRead` 可展示尚未通过 runtime 编译的结构化候选，不把校验失败伪装成空图。
- `pnpm --filter @data-agent/contracts build`、`pnpm --filter @data-agent/semantic typecheck` 通过。
- Contracts 全量 45 files / 614 tests 通过；Semantic 全量 13 files / 126 tests 通过。
- 10,000 Node fixture 首屏只返回 20 个 cluster glyph，反序输入 hierarchy digest 保持一致。
