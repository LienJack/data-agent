# Semantic Studio 图体验设计

## Information Architecture

`/semantic` shell 含节点、关系图、全图、候选与审核、版本与血缘。现有 Explorer/Review 不删除，
改为使用统一 Graph v2 read model 的 shell 视图。

## Shared State

按 release/candidate key 建立 normalized graph store，初始加载 projection，随后按 sequence 应用
typed patches。Node List、Local、Full、Detail、Diff 只从该 store 读取 identity/status/selection。

## Rendering

- Node List：server filtering/pagination + virtual rows。
- Local：改造现有 SVG，1/2-hop、预算提示、accessible table fallback。
- Full：client-only Sigma + Graphology；server hierarchy/release layout/stable seed 决定初始位置，
  ForceAtlas2 worker 只做固定预算局部松弛。Candidate Node 以 cluster/邻居质心 + ID hash 微偏移放置。
- 每层最多 500 glyph；cluster glyph 带准确 count 和可解释筛选结果。

## Composer

Composer 跨三种创作视图持久，携带可移除的 domain/release/candidate/selection/viewport context。
所有编辑入口只生成意图草稿。Timeline 显示公开 stage/tool/patch/validation/clarification，不显示
私有推理。

## Recovery and Accessibility

SSE 以 cursor/sequence 重放，store 用 patch digest 去重。颜色同时辅以 badge、线型、图标和文本；
图操作有键盘入口、详情和表格 fallback。
