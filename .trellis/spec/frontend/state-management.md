# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

Q&A 使用 Zustand 保存跨组件 UI 状态，但持久化服务端状态仍来自严格 API/SSE Projection。

---

## State Categories

<!-- Local state, global state, server state, URL state -->

- UI state：当前 Conversation、Inspector、Composer 和连接状态。
- Server projection：Conversation directory、Run events、resource catalog；不得在浏览器重建权威绑定。
- URL state：Workspace、Conversation 与 Inspector focus，必须通过既有 route helpers 同步。

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

只有跨多个 Q&A surface 且需要在路由切换后保留的展示状态进入 `qa-store.ts`。协议状态机、网络重试、
AbortController 和 sequence cursor 必须放在独立的 `qa-run-stream.ts`，通过 typed callback 投影给 Store。

---

## Server State

<!-- How server data is cached and synchronized -->

服务端 Run/Conversation 数据不在 Zustand 中成为第二权威。断线恢复使用服务端 `sequence`，重复事件按
`run_id + sequence` 去重，terminal 后再读取最终 Run Projection 兜底。

---

## Common Mistakes

<!-- State management mistakes your team has made -->

- 在 Store action 内复制 SSE reconnect while-loop。
- 用数组长度、时间戳或客户端计数器代替服务端 `sequence`。
- Route、Store 和组件各自持有一套 Run terminal 推导。
