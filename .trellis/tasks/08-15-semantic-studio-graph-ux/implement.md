# Semantic Studio 图体验执行计划

- [x] 建立 Studio shell 和统一 Graph v2 client store/types/status tokens。
- [x] 实现默认 Node List、筛选/搜索/虚拟化、detail 和 selection routing。
- [x] Local Graph 消费 bounded neighborhood/store，支持 1/2-hop、方向与截断提示。
- [x] Full Graph 使用 cluster-first 语义缩放，按需展开 Node，并提供可访问 fallback。
- [x] 实现 persistent Composer、authoring run timeline、clarification 和 SSE patch replay。
- [x] 移除 JSON textarea/JSON.parse/direct mutation 路径，将所有编辑入口路由至 Composer。
- [x] 完成无障碍、responsive、断线、10k/list、250/500/500 模型与浏览器验证。
- [ ] 完成 scoped commit 并归档 child。

```bash
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web test:unit
```

Go/No-Go：任何 UI 能绕过 Agent 写候选、四视图 identity/status 不一致、SSE 重放重复 patch 或图无
可访问 fallback 时不进入 rollout。

## 验证证据

- `pnpm --filter @data-agent/web typecheck`：通过。
- `pnpm --filter @data-agent/web test:unit`：50 files passed、1 skipped；179 tests passed、1 skipped。
- Graph v2 contracts/platform 定向测试：3 files、9 tests 全部通过。
- 10640 migration renderer verify：通过，checksum `sha256:c5fb8ac4426ecfbce593005b220d07e45c38b66ee44991d767c5b2e953c4482d`。
- PostgreSQL authority assertions：通过，覆盖 active/draft/idempotency/direct-write deny/RPC permission。
- Lighthouse：Accessibility 96、Best Practices 100、SEO 100、Agentic Browsing 100；唯一失败为任务外全局 status bar 的既有文字对比度。
# 实施计划

## 1. Studio Shell 与共享状态

- 新增 workspace 级 `/w/:workspaceId/semantic`，默认进入 Node List。
- List、Local、Full、Detail 和 Composer 共享 selection、domain、candidate 与 consistency token。

## 2. 三种浏览视图

- Node List 提供搜索、类型/状态筛选、关系数和候选状态。
- Local Graph 以选中 Node 为中心展示有向 Edge、1/2-hop 与截断状态。
- Full Graph 首屏展示 cluster，点击后按需展开 Node；提供无障碍表格 fallback。

## 3. Agent-only 编辑

- 新增/编辑/连接/退役入口只填充持久 Agent Composer。
- Composer 携带 domain/release/selection，上报自然语言或公式意图。
- Timeline 展示公开 stage/tool/patch/validation/clarification，候选 patch 实时刷新三种视图。

## 4. 验证

- 对 view model、API 重放去重、Composer 上下文与错误终态做单元测试。
- 类型检查、构建、浏览器截图验证桌面与窄屏关键状态。
