# 实施计划

## 1. Contracts 与纯领域逻辑

- [ ] 完善 export/hash material、import state、mapping、preview、receipt 与 API input DTO。
- [ ] 增加 canonical hash、strict unknown field、恶意 secret 和 1 MiB 边界测试。

## 2. PostgreSQL authority

- [ ] 新增 10632 source migration、renderer、checksum、RLS/GRANT/postcondition 与 smoke assertion。
- [ ] 建立导入 job/mapping/operation/receipt，并证明 workspace composite FK 与 audit immutability。

## 3. Platform repository

- [ ] 实现 published-only export、upload、list/get、mapping、dry-run、cancel 与 atomic commit。
- [ ] 覆盖无发布版本、哈希错误、映射缺失/跨 workspace、幂等冲突和 rollback 测试。

## 4. Web API 与界面

- [ ] 实现 workspace-scoped route handlers 与稳定错误映射。
- [ ] 增加语义导入导出 panel，覆盖 loading/empty/error/paused/ready/success。
- [ ] 只截取一张关键界面截图做视觉核对。

## 5. 验证与收口

- [ ] contracts/platform/web build、typecheck、unit tests 与 Biome 通过。
- [ ] static-check 与真实 PostgreSQL smoke 通过。
- [ ] round-trip、失败无部分草稿、成功永不 published 验收通过。
- [ ] 更新父计划、任务证据与必要 spec，按任务独立 commit。

## Validation commands

```bash
pnpm --filter @data-agent/contracts build
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/platform build
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web test:unit
./infra/supabase/test-support/static-check.sh
./infra/supabase/test-support/run-postgres-smoke.sh
git diff --check
```
