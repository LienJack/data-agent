# Semantic Studio 图体验执行计划

1. 建立 Studio shell 和统一 Graph v2 client store/types/status tokens。
2. 实现默认 Node List、筛选/搜索/虚拟化、detail 和 selection routing。
3. 改造 Local Graph 消费 bounded neighborhood/store，加入 1/2-hop 和 truncation UX。
4. 实现 Sigma/Graphology Full Graph adapter、cluster zoom、worker layout、filter/path/search。
5. 实现 persistent Composer、authoring run timeline、clarification 和 SSE patch replay。
6. 移除 JSON textarea/JSON.parse/direct mutation 路径，将所有编辑入口路由至 Composer。
7. 完成无障碍、responsive、断线、10k/list、250/500/500 浏览器验证。
8. 运行验证、scoped commit 并归档 child。

```bash
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web test:unit
```

Go/No-Go：任何 UI 能绕过 Agent 写候选、四视图 identity/status 不一致、SSE 重放重复 patch 或图无
可访问 fallback 时不进入 rollout。
