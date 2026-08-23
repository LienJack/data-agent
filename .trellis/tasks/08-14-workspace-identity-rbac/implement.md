# 工作空间身份与 RBAC 实施计划

## Phase 0：契约与迁移基线

- [x] 更新 backend spec：app-global 私有对象例外、workspace 权限矩阵、账务精度/状态机。
- [x] 新增 workspace/identity/RBAC/price/FX/credit/bill/semantic portability strict contracts。
- [x] 新增 contract 测试：happy、边界、未知字段/状态/角色失败关闭。
- [x] 新增固定 tenant 与 Web 内存 repository characterization tests。
- [x] 写入 reason-code matrix 与现有表 workspace migration inventory。
- [x] 锁定 Better Auth 1.6.23，记录 MIT、Next 16/PostgreSQL/Node 26 兼容证据；生成并审查
  auth SQL，不启用启动时 migration。

Phase 0 gate：

```bash
pnpm --filter @data-agent/contracts build
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/web typecheck
```

## Phase 1：身份、工作空间与 RBAC

- [x] 新增 10627 migration source、renderer、checksum migration 与静态测试。
- [x] 创建 auth schema、app users、workspaces、membership 扩展、operation receipt/audit。
- [x] 只验证 clean install；开发库存在旧数据时重建，不实现在线升级或存量回填。
- [x] 实现 SQL workspace authority 与幂等 admin/member 命令。
- [x] 扩展 Platform workspace capability resolver 和 conformance fixtures。
- [x] 集成 Better Auth server/client、auth route、session principal resolver，关闭 sign-up。
- [x] 实现受控 superadmin bootstrap CLI。
- [x] 实现登录页、workspace selector、workspace 路由骨架与按角色过滤的导航。
- [x] 增加 user disabled、membership revoked/role changed、workspace archived、跨 workspace、
  idempotency replay/conflict 测试。

Phase 1 gate：

```bash
pnpm --filter @data-agent/contracts build
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/platform test:tenancy
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web lint
pnpm exec tsx scripts/render-10627-migration.ts --verify
infra/supabase/test-support/static-check.sh
infra/supabase/test-support/run-postgres-smoke.sh
```

## 集成复核

- [x] 搜索第二套 `project_id`、客户端 role/principal authority 和公开 bootstrap。
- [x] 核对 diff 只包含本任务与必要的 lockfile/package exports 变更，不覆盖现有脏树成果。
- [x] 明确 Phase 2 前尚未切换的 legacy route/repository，不能把 Phase 1 当作 AC1-AC4 完成。
- [x] 更新父任务 Phase 0/1 进度和证据；综合门禁恢复后再进入 Trellis finish 流程。

## 2026-08-14 验证证据

- Contracts：build/typecheck 通过，34 个文件、573 项测试通过。
- Platform：typecheck 通过，workspace PostgreSQL authority 4 项定向测试通过。
- Web：typecheck、全量 Biome lint 通过，27 个测试文件通过、1 个跳过（104 项通过、1 项跳过）；
  真实登录 200、sign-up 403、workspace 首页 200。
- PostgreSQL 17：删除并重建 `data-agent_pgdata` 后 31 条迁移从零安装，最新账本为 10627；
  bootstrap 首次成功、重复创建失败，最终只有 1 个 active superadmin 和 1 条 bootstrap audit。
- 10627 renderer checksum 为
  `sha256:5f451046c00eb2963850e5985eaa3f3d991cc7addeba21bdce6c2f33283bd2f1`；inventory 覆盖
  149 张表（142 workspace-scoped、7 app-global）。
- 全量 `@data-agent/web lint` 检查 211 个文件无错误；QA/Data Link 与 Workbench 中原有的
  格式、导入和可访问性问题已用安全机械修复及语义 HTML 收敛。
- PASS：`static-check.sh` 通过 40 项 U6 测试、全部 renderer 与 SQL 静态校验；C2 physical
  descriptor checksum 为
  `sha256:f404abca017479c92103aa85ee58a38865bfe89b0e4d7038829f9629bfcf0a30`。
- PASS：`run-postgres-smoke.sh` 从零应用完整迁移并通过全部 PostgreSQL assertion；10600
  migration checksum 为
  `sha256:5027cff89a3dd09ba96025559adde4250bcf6a24f22e45d7f8bf87b246741d46`。
