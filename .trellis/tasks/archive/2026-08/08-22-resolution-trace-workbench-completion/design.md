# 运行轨迹工作台完整验收补齐设计

## 1. Read model

```text
PostgreSQL authority
  ├─ owner ResolutionTrace + ResolutionTraceDetail
  ├─ Agent Team public projection RPC
  └─ admin audited replay/detail/artifact projection + immutable receipt
        ↓ strict contracts
pure workbench model / durable event reducer
        ↓
timeline + virtual list + content-first Inspector + exact Artifact preview
```

## 2. Detail context

`ResolutionTraceDetail` 增加严格 `run_context`：用户问题、Run 权威状态、创建/更新时间、attempt/fence、Conversation
binding/title、冻结 Effective Config 公共摘要。它由与节点详情相同的 READ transaction 构建，客户端不再从多个当前资源
API 拼接历史事实。缺少冻结 display name 时返回显式 availability/reason，而不是把 ID 当内容。

## 3. Team public content

新增 forward migration 提供 `load_agent_team_public_projection_v2(uuid)`，保留 v1 历史 RPC 与同一 owner-only
identity predicate。v2 RPC 先调用 v1 完成 corruption checks，再从以下已验证文档只投影 allowlist：

- Task：goal revision、bounds、required output types、artifact refs、context epoch ref；同 task 的 Public Agent Event
  提供 title/summary/phase/error/start/end/duration。
- Completion：completed_at 与 exact output_ref。
- Handoff：父/子 Agent、child required output types 与 bounds 摘要，不公开 capability 或完整 command。
- Epoch：phase/revision、obligation总数/未解决数、included Artifact refs；不公开 raw context body。
- Verifier/Acceptance：七个公共维度、semantic status、verdict/reason、decided/accepted time 与 output ref。

Contracts 升级为 additive `agent-team-public-trace@2.0.0`（或明确版本化 union），旧 v1 历史响应可读，Web 优先渲染
v2 内容，v1 显示稳定 unavailable。

## 4. Admin audit

管理员不能复用 owner capability，也不另建第二套 Trace authority。复用既有 audited `RUN_REPLAY`，按 exact
workspace + owner + conversation + run + sequence 读取已验证 PublicRunEvent 并返回 immutable receipt；Artifact 内容继续走
audited `ARTIFACT_PREVIEW` exact revision。管理员工作台从这两条内容路径组装视图，普通用户无法调用 admin route。

## 5. Client behavior and scale

- 同一 `selectedNodeId` 驱动时间轴、列表与 Inspector；edge parents/children 作为一层可读关系标签。
- timeline projection 每泳道最多 300；virtual list 最多 80 行；priority 保留 selected/match/problem nodes。
- trace hash 变化清 detail cache，但同 Run 保留用户选择/窗口/搜索；Run 改变才重置。
- durable reducer 以 `(run_id, sequence)` 合并 baseline/replay/append；terminal 不被旧 replay 降级。

## 6. Verification

`completion-audit.md` 是最终 requirement-to-evidence ledger。每个 AC 必须指向测试名、浏览器断言、合同或 migration
assertion；缺失证据即未完成。
