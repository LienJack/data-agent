# Legacy Attribution Route and Runtime Retirement — Design

## 1. Boundary

本设计只移除用户可达的旧产品入口与 executor path。它不删除 Attribution 领域词汇，也不把
`controlled-attribution`、F9 gate 或 10620/10621 authority 误判为旧 UI 垃圾。

```text
Workspace navigation ──┐
legacy /analysis route ├─> authorize ─> /w/:workspaceId/qa
root /                 ┘                 (唯一分析 surface)

Q&A question ─> classify ATTRIBUTION ─> durable DEFERRED
                                      └─X LEGACY_FIXED@1 / Worker lease
```

## 2. UI And Route Retirement

`WorkspaceNavigationKey` 删除 `analysis`，由类型系统迫使 Sidebar、Mobile Nav、Topbar、Workspace Home、
Icon map 和 Shell 状态条一起收口。Sidebar 删除旧 Workbench projection 快捷项；底部只读 F9 治理状态保留，
因为它不是产品入口且仍属于受保护的评测证据。

旧 route 使用服务端 page：

1. `getCurrentWorkspaceSession()`；失败重定向 `/login`；
2. 并行执行 `listSessionWorkspaces()` 与 `resolveSessionWorkspaceCapability(..., "READ")`；
3. 任一 authority 失败、workspace 不在授权列表、缺 `ANALYSIS_RUN_CREATE` 时统一重定向 `/workspaces`；
4. 成功后 `redirect(workspacePath(workspaceId, "qa"))`。

使用与 Workspace shell 相同的 non-enumerating redirect 语义，不恢复旧 deep link。

root `apps/web/src/app/page.tsx` 替换为服务端 `/workspaces` redirect，消除 Next redirect config 失效时的旧
Workbench fallback。`analysis-run-submission.ts` 保留给 generic run effective-config characterization test；它不再有
页面 consumer，也不被重新命名成新归因 runtime。

## 3. Runtime Fail-Closed Rule

`planAgentDispatch()` 在能力快照 hash 冻结后、所有 rollout 分支前短路 `ATTRIBUTION`：调用现有
`adaptivePlan()` 生成权威 deferred receipt 并返回 `shadow_plan=null`。这样 SHADOW 不再创建 exact-three
`LEGACY_FIXED@1` binding，ROOT_ONLY 与 ENFORCED 也得到相同公开状态。

Worker 无需识别问题文本：它只消费 `EXECUTE` admission；DEFERRED authority 不创建 runnable Run/outbox/lease，
沿用 adaptive-dispatch 已冻结的跨层边界。

## 4. Inventory Classification

| Class | Examples | Action |
| --- | --- | --- |
| product-only | navigation item, `/analysis` page, root Workbench page consumer | retire/redirect |
| shared protected | controlled-attribution eval, contracts, F9 gates, billing/identity/security audit | retain |
| attribution authority | 10620/10621 rows | inventory only; later exact cleanup candidate |
| ambiguous generic | generic Run/Event/Artifact/usage rows | retain; no durable origin discriminator |

任何历史删除都不能通过 URL、question text、Artifact type 或表名 glob 识别。后续 cleanup command 必须绑定独立批准、
inventory digest、PITR/备份状态、引用/hold/before counts，并在同一事务重验。

## 5. Tests

- Platform unit：ATTRIBUTION 在三种 rollout 下均为 stable DEFERRED，且无 shadow plan。
- Web characterization：导航不再含 analysis；旧 route 源码先授权再重定向；root 仅 redirect。
- Static audit：Web source 不含旧 i18n key/中文产品文案；除兼容 route 外没有 `/analysis` user link。
- Regression：existing Q&A deferred disclosure、controlled-attribution/shared references 仍存在。

## 6. Release Boundary

本 child 完成只证明入口与可达 runtime 退役。没有 destructive receipt、PITR evidence、exact before/after count，
因此历史数据 cleanup 保持 HOLD，且不阻塞本 child 或 parent 非破坏性交付。
