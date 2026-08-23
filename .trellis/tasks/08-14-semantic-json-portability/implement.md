# 实施计划

## 1. Contracts 与纯领域逻辑

- [x] 完善 export/hash material、import state、mapping、preview、receipt 与 API input DTO。
- [x] 增加 canonical hash、strict unknown field、恶意 secret 和 1 MiB 边界测试。

## 2. PostgreSQL authority

- [x] 新增 10632 source migration、renderer、checksum、RLS/GRANT/postcondition 与 smoke assertion。
- [x] 建立导入 job/mapping/operation/receipt，并证明 workspace composite FK 与 audit immutability。

## 3. Platform repository

- [x] 实现 published-only export、upload、list/get、mapping、dry-run、cancel 与 atomic commit。
- [x] 覆盖无发布版本、哈希错误、映射缺失/跨 workspace、幂等冲突和 rollback 测试。

## 4. Web API 与界面

- [x] 实现 workspace-scoped route handlers 与稳定错误映射。
- [x] 增加语义导入导出 panel，覆盖 loading/empty/error/paused/ready/success。
- [x] 只截取一张关键界面截图做视觉核对。

## 5. 验证与收口

- [x] contracts/platform/web build、typecheck、unit tests 与 Biome 通过。
- [x] static-check 与真实 PostgreSQL smoke 通过。
- [x] round-trip、失败无部分草稿、成功永不 published 验收通过。
- [x] 更新父计划、任务证据与必要 spec，按任务独立 commit。

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

## Evidence

- Contracts：40 个测试文件、592 个测试通过；语义移植专项 9 个测试覆盖版本、哈希、重复引用、
  明文凭据、Viewer 拒绝与事务回滚。
- Platform：39 个测试文件、269 个测试通过；build/typecheck 通过。
- Web：34 个测试文件中 33 个通过、1 个按既有条件跳过，共 124 个测试通过；Next.js
  production build 与 typecheck 通过。
- PostgreSQL：10632 checksum `sha256:eca40306594985cc431b3e615f0dd85254e70c5b7f79122d5f75552dc2fe90d0`；
  static-check 与完整 smoke assertions 通过。
- 原子性：第二个候选创建故障触发整笔 `ROLLBACK`，receipt 不落库；数据库 trigger 只接受
  真实 `DRAFT` candidate/revision，导入流程不更新 active release 或 published pointer。
- 运行时：本地 10632 安装后，`imports` 与 `targets` 工作空间接口均返回 200；Next.js 分包
  场景的事务权威标记改为全局稳定 Symbol。
- 视觉核对：`/Users/lienli/.codex/visualizations/2026/08/14/019fff6b-8633-72c1-ac95-e8f739243566/phase6-semantic-portability.png`。
- 提交：`8fd71c1`、`61b52ce`、`cad69d3`、`a45a1e1`、`368656d`。
