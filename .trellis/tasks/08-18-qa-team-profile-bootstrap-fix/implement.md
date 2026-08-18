# Implementation Plan

- [x] 加载 backend/frontend 相关 Trellis specs，并确认所有目标文件的现有未提交 ownership。
- [x] 为 Q&A readiness orchestrator 写失败优先测试：显式确认、environment guard、缺 authority/resource、
      步骤顺序和幂等 read-back。
- [x] 实现独立本地/demo readiness orchestrator 与 CLI，复用 Capability Authority、Model Control、
      Schema Discovery、Effective Config、Skill/Profile Registry；不直接写受治理表。
- [x] 增加真实本地验证，证明 Snapshot、Defaults、九 Skill、三 Profile 和 Team Run acceptance 闭环；
      `10670` migration 使 Command/Idempotency/Event/Outbox/Audit hash 原子一致。
- [x] 为 Web API error envelope 写失败测试并实现 `ApiRequestError`/安全 fallback；让 Q&A 展示 code + message。
- [x] 运行 focused tests，然后运行受影响 package typecheck、Biome 与必要 integration checks。
- [x] 使用 CLI 修复当前本地 workspace，右侧浏览器重新发送问题并抓取 POST 201 验证。
- [x] 执行 Trellis check、更新必要 spec/runbook、检查 diff 仅含本任务 hunk。
- [x] 按任务范围创建一个 Git commit，不包含工作区其他改动。

## Expected Validation

```bash
pnpm exec vitest run --exclude '**/.next/**' <focused bootstrap tests> apps/web/test/api-client.spec.ts
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/worker typecheck
pnpm exec biome check <owned files>
pnpm exec tsx <qa-readiness-cli>   # explicit local confirmation env
```

## Risky Files / Rollback Points

- `apps/web/src/lib/api-client.ts` 是共享客户端边界；保持旧 Error message fallback，并覆盖所有非 JSON 分支。
- Product Profile materialization 必须最后执行；任何改动不得把 Team gate 移到 acceptance 之后。
- 当前 `package.json`、local runtime、superadmin/ecommerce bootstrap 已有用户改动；本任务不依赖修改这些文件。
- 若跨 app import 破坏依赖方向，优先把 orchestrator 放在顶层 `scripts/` 并依赖公开 package/窄导出，
  不让 Web package 依赖 Worker app。

## Validation Results

- `apps/web/test/api-client.spec.ts` + `tests/qa-readiness-bootstrap.spec.ts`: 6 passed.
- Web/Worker TypeScript typecheck: passed.
- Biome owned-file check: passed.
- `render-10670-migration.ts --verify`: passed.
- 当前 workspace readiness 首次 `QA_READINESS_BOOTSTRAPPED`，重跑 `QA_READINESS_ALREADY_READY`。
- Browser: Q&A POST 从 400/503 修复为 201；Run 持久化为 `START_DATA_AGENT_TEAM`。
- Live PostgreSQL: Command、Idempotency、Event、Event Document、Outbox、Audit hash 全部一致。
- 隔离 PostgreSQL smoke 未到达 10670：并行工作区的 `10668` 已注册但缺少
  `scripts/render-10668-migration.ts`，静态门提前终止；不是本任务文件或断言失败。
