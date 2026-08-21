# 管理员对话审计平面实施计划

> 状态：已实施并完成纵向验收

## Phase 0 — Baseline And Task Gate

- [x] 用户批准本 PRD/design/implement 后运行 `task.py start 08-21-qa-admin-audit`。
- [x] 固定 dirty-tree baseline；排除 Falcon artifacts、knowledge semantic task 与 tsbuildinfo。
- [x] 读取 backend database/workspace identity/logging/run streaming、frontend component/design/type-safety 与 shared cross-layer/reuse specs。
- [x] 跑 Contracts/Platform/Web 与 10673 focused baseline；确认 Web/Worker/Indexer/DB health。

## Phase 1 — Contracts

- [x] 新增 admin scope、directory query/page、conversation detail、event/trajectory/subagent/artifact authorization 与 receipt ref strict schemas。
- [x] 绑定 workspace/owner/resource identity、allowlisted reason/action、cursor/query digest；补 unknown/tamper tests。
- [x] 单点 export，运行 Contracts unit/typecheck/build。

## Phase 2 — PostgreSQL 10675

- [x] 创建分段 migration source、renderer、checksum、static check；禁止改 10673。
- [x] 创建专用无登录 owner、append-only receipt、immutable trigger、FORCE RLS、最小 grants。
- [x] 实现 DB-authoritative Workspace Admin/Super Admin scope resolver。
- [x] 实现目录、消息、event replay、trajectory、subagent、artifact read authorization 的 audited RPC；receipt 与 projection 同事务。
- [x] 覆盖 trash-before-purge、post-purge denial、revocation、cross-workspace/owner mismatch、receipt failure rollback。
- [x] Fresh PostgreSQL 17 full migration chain + assertion；证明 base owner policies/grants 未放宽。

## Phase 3 — Platform And Routes

- [x] 新增独立 Postgres admin audit repository，所有 unknown 在边界 parse。
- [x] 新增 Workspace Admin 和 Super Admin route namespaces；现有 session preflight + DB revalidation。
- [x] 为 messages/events/SSE/trajectory/subagent/artifact preview/export 接入独立 admin transport。
- [x] SSE connect/replay/heartbeat 重验；Abort/generation guard；撤权关闭且不推进 Run 状态。
- [x] 补 repository、route、non-enumeration、double-gate focused tests。

## Phase 4 — Admin UI

- [x] `/w/:workspaceId/qa/admin`：只读 banner、owner/folder/lifecycle/live/search filters、分页目录、返回个人目录。
- [x] `/admin/qa`：仅 Super Admin，Workspace selector 后复用 admin directory component。
- [x] 独立 admin store，禁止 owner mutation actions；复用 rich answer/activity/Inspector/Artifact display leaf。
- [x] 详情不渲染 Composer、Run control、folder/conversation action menu；测试伪造 mutation 仍被 server/DB 拒绝。
- [x] desktop/mobile keyboard/focus/empty/loading/error/revoked/audit-failed tests 与 i18n。

## Phase 5 — Vertical Acceptance

- [x] 两普通用户 owner isolation；管理员个人目录不混入跨 owner 数据。
- [x] Workspace Admin 当前 Workspace、Super Admin exact Workspace；cross-scope 全拒绝。
- [x] 列表、详情、SSE reconnect、trajectory、subagent、preview/export 每次产生脱敏 receipt evidence。
- [x] Trash 可审计、purge 后不可恢复；撤权后现有 SSE 停止且晚到 frame 被拒。
- [x] 1440x1000 与 390x844 真实浏览器截图；截图/SQL/SSE receipt 做 Secret/PII 检查。
- [x] Web production build、scoped Biome、typecheck、focused/full relevant tests、`git diff --check`。

## Phase 6 — Review And Finish

- [x] 使用 `trellis-check` 做 security/data-integrity/correctness review，修复 P0/P1/P2 或记录 HOLD。
- [x] 使用 `trellis-update-spec` 将 admin audited read pattern 写入 backend/frontend executable spec。
- [x] 只 stage owned paths，创建 scoped implementation commit。
- [ ] archive child、记录 journal，再进入 `qa-apple-glass`。

### Validation HOLD

- Platform 全量中仅 `test/semantic/postgres-semantic-induction.spec.ts` 的既有并行语义归纳 fixture 仍失败：fixture 含非 ontology-alignment foundational fact。管理审计相关 Platform 502/502（排除该文件）和 focused 9/9 均通过，本任务不修改该并行领域。

## Rollback Points

- 10675 前：停止部署，无数据变更。
- 10675 后：撤销 admin RPC EXECUTE 并隐藏入口；不删除 receipts，不修改历史 migration。
- UI/API 后：关闭 admin route feature exposure，不回退 owner directory authority。
