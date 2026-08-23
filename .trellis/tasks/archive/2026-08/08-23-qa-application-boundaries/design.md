# Q&A 应用边界设计

- Server use-case：`apps/web/src/server/qa/start-question-run.ts`，依赖端口由 composition root 注入。
- Route adapter：现有 `runs/route.ts` 解析 NextRequest/params，并投影 use-case result。
- Client stream：`apps/web/src/lib/qa-run-stream.ts` 持有 AbortController、cursor、reconnect policy 和 typed callbacks。
- Zustand Store 只协调 conversation/message UI state，消费 stream 投影。
