# M4 设计

## 数据流

```text
Published Release snapshot
  -> Resolved Context service
  -> strict read-only ResolvedContextPreviewResult
  -> Context Preview lexical evidence / clarification inspection

Schema Drift -> M3 immutable impact receipt
  -> PostgreSQL get_semantic_binding_impact safe projection
  -> SemanticBindingImpactService.get
  -> Workspace READ route
  -> Explorer impact summary
  -> existing exact Candidate comparison (optional)

fixed replay summary input
  -> strict Falcon semantic accuracy builder
  -> content-addressed B0/B1 result + B2 deferred decision
```

## 边界

- Web 组件只消费 `@data-agent/contracts` strict projection，不读取数据库 shape 或解析 unknown。
- `workspace-semantic-runtime` 负责 Capability 与 adapter 注入；route 只解析请求并调用 application service。
- Binding Impact route 只有 GET。M3 analyze/commit 继续属于维护 Job，不暴露为浏览器写接口。
- Impact safe projection 只含 counts、risk、actions、reason codes、release identity、candidate ref 与 receipt/hash；对象明细从既有 Candidate diff/Explorer object 读取。
- 澄清 radio 是非权威本地 selection，不自动提交、不改 question、不调用第二次 API；UI 明确提示需改写问题后重新解析。
- Falcon semantic accuracy summary 是独立 current artifact，不改变既有 Agent release gate，也不把历史 Falcon GO 当作 M1 后召回证据。

## Falcon lane

- B0 `EXACT`：固定语料 exact-only baseline。
- B1 `LEXICAL`：M1 current lexical candidate，必须与 B0 同 corpus/source/release；exact regression、ambiguity misselection、cross-release 和 unauthorized hit 均为 0。
- B2 `GOVERNED_RETRIEVAL`：本次只能是 `DEFERRED / M2_GATE_NO_GO`，不存在第三条运行时代码。
- Builder 重算 totals、outcome counts 和 hash；未知字段失败关闭。没有逐 case 安全结果时不能构造 EVALUATED lane。

## UI

- 使用现有 reading surface、border/divider、Data Agent Blue 和 amber/red 状态色；移除 Candidate band 的 violet/dark-theme 样式。
- Evidence 是紧凑 definition list/table；hash/ID 使用 mono，release identity 可换行，390px 下不扩张容器。
- 原生 fieldset/radio 提供键盘行为；异步错误使用 `role=alert`，加载状态使用 `role=status`。
