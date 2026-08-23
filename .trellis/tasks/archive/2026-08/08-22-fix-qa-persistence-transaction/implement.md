# 实施计划：Q&A 持久化事务与轨迹 schema 修复

## 1. Test-first characterization

- [x] 在 Platform migration test 中加入失败断言：10696 必须保持 ledger checksum，repair migration 必须包含 validator 的 transitive grant 与 deny postconditions。
- [x] 在 `postgres-resolution-trace.spec.ts` 加入 SQL 回归断言：不得引用 `run.active_attempt_id`，必须只解析 `run_attempts.status = 'ACTIVE'`。
- [x] 运行 focused tests，确认现状按预期失败。

## 2. Restore migration immutability

- [x] 将 `migration-sources/10696` 中 13:48 后的三组改动移出并恢复到已应用版本。
- [x] 运行 `pnpm exec tsx scripts/render-10696-migration.ts`，确认生成 checksum 为 `sha256:8e74...cdac2`。
- [x] 运行 renderer `--verify`。

## 3. Add forward repair migration

- [x] 创建 10698 migration source、renderer 与 generated SQL（如现有相邻 migration 采用单文件，则保持相邻惯例并至少提供 checksum static test）。
- [x] 前向重建 Profile revocation 与 Root Harness `visible_message_refs` 行为。
- [x] 添加 validator 精确 grant、PUBLIC/backend deny 与完整 postconditions。
- [x] 验证 renderer、checksum 和静态测试。

## 4. Fix Platform query

- [x] 将 active attempt 改为 scope/run-bound `run_attempts.status='ACTIVE'` lateral projection。
- [x] 保持 terminal/no-attempt 为 `null`，不增加 fallback 或当前 Catalog 查询。
- [x] 运行 Resolution Trace focused tests 与 Platform typecheck。

## 5. Apply and verify local database

- [x] 记录 migration 前 ledger 与目标 workspace 的 Conversation/Message/Run/Outbox 计数。
- [x] 运行 `pnpm dev:migrate`，只应用 missing 10697/10698；不得手工编辑 ledger。
- [x] 查询 10696/10697/10698 ledger、v2 RPC、validator owner/ACL 与 `has_function_privilege`。
- [x] 对比目标 workspace 行数，证明零数据删除。
- [x] 检查新的 PostgreSQL 日志窗口，不再出现 `permission denied for function subagent_catalog_snapshot_is_valid`、`run.active_attempt_id does not exist`、`load_agent_team_public_projection_v2 does not exist`。

## 6. Quality and delivery

- [x] 运行 migration/Platform focused tests。
- [x] 运行相关 renderer verify、Platform typecheck、target-scope Biome 和 `git diff --check`。
- [x] 检查 `git status`，仅 stage 本任务拥有的 migration source/generated/test、Platform source/test。
- [x] `git diff --cached --check` 后创建一个 scoped commit。
- [x] 运行 Trellis finish-work，记录验证结果与 commit。

## Verification results

- Work commit: `d55e67f`.
- 10696 renderer/checksum: `sha256:8e74cfd247270428117ffed554f6020ba0c752881d19012d3ad64438acecdac2`，并与已应用历史 bytes exact compare 通过。
- 10698 renderer/checksum: `sha256:4ed26320816c7bd3a06133c5c67322e5d8d0cf26c84e3198754660af7482faaa`。
- Focused Vitest: 2 files / 11 tests passed；Platform typecheck、target-scope Biome、`git diff --check` 通过。
- `pnpm dev:migrate` 成功应用 10697/10698；validator ACL 为 Effective Config owner allow、backend/PUBLIC deny。
- 目标 workspace 前后计数一致：Conversation 9、Message 81、Run 43、Effective Config Receipt 43、Outbox 45。
- Platform 全量 unit：522 passed / 1 unrelated failed；失败位于并行 Semantic Induction fixture `postgres-semantic-induction.spec.ts`，不在本任务 diff。
- `pnpm dev:check` 仅因用户现有 Next 进程 PID 86051 占用 3000 端口而退出；未停止该进程。

## Risky files / rollback points

- `infra/supabase/apps/data-agent/migrations/20260725010696_*`：只能恢复已登记 bytes，不能产生第三个 checksum。
- 新 10698：必须在单事务 postcondition 后登记；失败时依赖 PostgreSQL rollback。
- `packages/platform/src/runs/postgres-resolution-trace.ts`：只修改 authority SQL 的 active attempt 来源，不改公开 DTO。
- `pnpm dev:migrate`：执行前后保留 ledger 与数据计数证据；不停止用户当前宿主机 Web 进程。
