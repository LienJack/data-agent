# Semantic Studio 图编辑体验 PRD

## Goal

把 `/semantic` 变为以 Node List 为默认入口的语义 Studio：用户可进入局部图或分层全图，并在
三种视图中通过同一个 Agent Composer 新增和修改候选 Node/Edge，实时看到图变化。

## Scope

- Studio shell、默认 Node List、Node/Edge detail。
- 1/2-hop Local Graph、community/semantic-zoom Full Graph。
- 跨视图 persistent Agent Composer、run timeline、clarification、candidate overlay。
- 现有 Review/Version/Lineage 整合与直接 JSON 编辑路径移除。

## Requirements

- `/semantic` 默认 Node List，行内只显示 Node 固有摘要和关系计数。
- 点击 Node 打开 1-hop，允许按 family/direction 扩 2-hop，并显示截断。
- Full Graph 先 cluster 后 Node，支持筛选、搜索、路径、展开/收起和回到选择。
- 同一 normalized store 驱动 List/Local/Full/Diff；selection、revision 和 candidate status 一致。
- create/edit/link/unlink/rebind/retire 按钮只打开/填充 Composer，不能直接持久化。
- 移除任意 operation JSON textarea/JSON.parse 提交和图拖拽/连线写语义。
- 每个 Agent mutation patch 增量更新视图；刷新/重连后按 cursor 恢复且不重复。
- 状态用颜色 + badge/线型表达，并保留键盘与无障碍表格 fallback。

## Out of Scope

- 前端执行 Agent 工具、前端持有发布 Authority、编辑任意 JSON、全量图 DOM/SVG 渲染。

## Acceptance Criteria

- [ ] Node List 是默认路由，支持类型/领域/Owner/生命周期/候选状态筛选和虚拟滚动。
- [ ] Local 1/2-hop 与 Full cluster zoom 使用同一 identity/status/selection。
- [ ] “新增成交商品数”“修改已支付公式”“新增商品维度”均从 Composer 启动并 live overlay。
- [ ] Added/Modified/Retired/Published 在所有视图使用一致且无障碍的视觉语言。
- [ ] 页面刷新或 SSE 断线恢复相同 run/patch，不重复创建 Node/Edge。
- [ ] 产品中不存在直接 Node/Edge JSON、任意 JSON Patch 或图手势写入入口。
- [ ] 10,000 Node list、local 250/500、full 500 glyph 浏览器基准通过。
