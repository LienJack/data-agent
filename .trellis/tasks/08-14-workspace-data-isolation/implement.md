# 工作空间持久化与数据隔离实施计划

## 1. 契约与失败测试

- [x] 在 `packages/contracts/src/workspaces` 增加 datasource、conversation、message、run
  binding strict DTO 与 Phase 2 reason code。
- [x] 增加 unknown-field、SecretRef scope、对象 ID、消息 metadata secret 边界测试。
- [x] 为旧 datasource/Q&A Map、固定 semantic/schema authority 和 `workspaceId="default"`
  写失败测试或静态扫描门禁。

## 2. 10628 Clean-install Schema

- [x] 新增 10628 source segments、renderer、checksum migration 和 static closure。
- [x] 建立 datasource、conversation、message、run binding 表及 workspace/membership/secret/
  run/semantic 复合 FK。
- [x] 启用 FORCE RLS、精确 backend grant、不可泄露与 postcondition 断言。
- [x] 更新 migration inventory、clean-install ledger 数量和 PostgreSQL fixtures/assertions。

## 3. Platform Repository

- [x] 实现 `createPostgresWorkspaceDataRepository` 和公开错误映射。
- [x] 所有方法使用 `withAppTransaction` + workspace transactional authorizer。
- [x] 覆盖双 workspace、跨 ID、角色、SecretRef、datasource freeze、两个实例一致性测试。

## 4. Web 受保护 API

- [x] 实现统一 workspace request guard 与 repository runtime。
- [x] 新增 `/api/workspaces/[workspaceId]/datasources/**` 和 Q&A conversation/message routes。
- [x] 旧无 scope mutation route 返回 `WORKSPACE_ROUTE_REQUIRED`，不再写 Map。
- [x] 更新 datasource/Q&A client、store 与页面 workspace 路由；移除 `default` 与开发身份
  header。

## 5. Semantic、Schema Discovery 与 Run 绑定

- [x] 用 request-scoped workspace capability 替代产品 route 的固定 semantic/schema
  tenant/principal resolver。
- [x] datasource metadata resolver 从 PostgreSQL repository 读取并验证 SecretRef scope。
- [x] 新产品 Run 入口在真实执行前验证并持久化 workspace datasource/conversation binding；
  现有 Run/Artifact/Attribution authority 保持唯一权威。
- [x] 审计所有产品入口的完整 scope predicate 和 datasource workspace 校验。

## 6. 质量门禁

```bash
pnpm --filter @data-agent/contracts build
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/platform test:tenancy
pnpm --filter @data-agent/web lint
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web test:unit
pnpm exec tsx scripts/render-10628-migration.ts --verify
infra/supabase/test-support/static-check.sh
infra/supabase/test-support/run-postgres-smoke.sh
rg -n 'workspaceId\\s*=\\s*"default"|NEXT_PUBLIC_DEV_USER_|SEMANTIC_(TENANT|PRINCIPAL)_ID|SCHEMA_DISCOVERY_(TENANT|PRINCIPAL)_ID' apps/web/src
```

门禁要求：静态扫描的产品请求路径为零命中；测试 fixture/显式 CLI 若仍使用固定 context，
必须与产品 route 分离并在代码中标明非产品入口。

## Rollback

如切换失败，停止 Web/Worker，回退应用代码并直接删除重建开发 PostgreSQL。不得恢复匿名
mutation route、Map 权威或长期双写。
