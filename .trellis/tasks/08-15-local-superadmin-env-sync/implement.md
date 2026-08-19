# 本地环境超级管理员与用户名登录实施计划

## Phase 1：Username 契约与 10634 Migration

- [ ] 为 username 3–30、lowercase normalization、允许字符、大小写冲突和唯一约束增加
  contract/数据库失败关闭测试。
- [ ] 新增 10634 source segments、renderer、checksum migration 与 static-check 注册；扩展
  auth user/app user username 字段、唯一约束和 postgres-only local sync function。
- [ ] 扩展 bootstrap 与 admin create-user 输入，使 username 在 Better Auth 与 PostgreSQL
  镜像中一致；更新管理 UI 的唯一用户名字段和错误处理。
- [ ] 真实 PostgreSQL 覆盖并发 username 冲突、非 local/非 postgres executor、session revoke、
  authz epoch、receipt/audit 和 Secret 脱敏。

Phase 1 gate：

```bash
pnpm exec tsx scripts/render-10634-migration.ts --verify
infra/supabase/test-support/static-check.sh
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/web test:unit
```

## Phase 2：测试先行与本地同步核心

- [ ] 为配置解析、username、默认关闭、production/local/executor guard、邮箱冲突、多管理
  员、workspace 解析和脱敏结果增加 Vitest。
- [ ] 将 bootstrap 的配置/事务逻辑提取为可复用、可注入依赖的 server-side helper，同时
  保持 `bootstrap-superadmin.ts` one-shot CLI 输出兼容。
- [ ] 实现 local sync service/CLI：零管理员创建、email/username/hash match no-op，任一变化
  走 10635 更新后的 narrow sync + session revoke。
- [ ] 新增根脚本 `dev:admin-sync`；任何输出禁止包含 password/hash/DSN credential。

Phase 2 gate：

```bash
pnpm exec vitest run --exclude '**/.next/**' apps/web/test/local-superadmin-sync.spec.ts
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web lint
```

## Phase 3：邮箱或用户名登录

- [ ] Server auth config 启用 `username()`，client 启用 `usernameClient()`；不开放自助注册。
- [ ] 登录表单改为单一“邮箱或用户名”输入，根据是否包含 `@` 调用官方 email/username
  endpoint，统一认证失败文案和成功跳转。
- [ ] 增加 UI/unit/integration 测试：邮箱成功、username 成功、大小写规范化、错误密码、未知
  username、停用账号和统一错误文案。

Phase 3 gate：

```bash
pnpm --filter @data-agent/web test:unit
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web lint
```

## Phase 4：本地启动集成

- [ ] 扩展 `local-dev-runtime.ts`：仅 `dev` 在 infra 后调用可选同步，`check` 保持只读。
- [ ] 把同步返回的数据库 workspace/principal 映射注入本次 readiness 与 child process env。
- [ ] 扩展 `tests/local-dev-runtime.spec.ts`，锁定开关判定、命令顺序、ID 映射和只读 check。
- [ ] 更新根 `package.json`、`docs/runbooks/local-development.md` 与
  `docs/runbooks/workspace-billing-operations.md`。

Phase 4 gate：

```bash
pnpm test:dev-runtime
pnpm typecheck
pnpm lint
```

## Phase 5：真实数据库与登录验收

- [ ] 在明确的本地 PostgreSQL 数据库上记录同步前非敏感计数；使用测试专用配置验证
  `UNCHANGED` 与 email/username/密码变化 `UPDATED`，并证明 session revoke、receipt/audit 正确。
- [ ] 验证非法配置、username/email 冲突和 production guard 均非零退出且输出不含
  测试密码。
- [ ] 启用 `.env` 同步执行 `pnpm dev`，验证 Authority 门禁和三个应用进程。
- [ ] 通过 Better Auth 登录端点证明邮箱和 username 均成功，旧 username/旧密码失败；不在
  输出、日志或任务文档保存密码。

Phase 5 gate：

```bash
curl --fail http://127.0.0.1:3000/
curl --fail http://127.0.0.1:9091/live
curl --fail http://127.0.0.1:9090/live
pnpm test:security
```

## Phase 6：用户、角色、积分与 Agent 计费贯通

- [x] 锁定 username 更新不改变 `principal_id`；新增用户创建成功后由数据库自动得到唯一
  credit account，identity 失败时 auth orphan 仍被补偿清理。
- [x] 扩展 Run lease/Worker 组合，使 Worker 从权威 Run 使用 owner principal，而不是用固定
  `WORKER_PRINCIPAL_ID` 作为普通用户执行和计费主体；每次执行重验 workspace capability。
- [ ] 将真实 ModelProviderPort 接入 research MODEL invocation 与 model billing authorize/
  finalize，Provider 只在授权成功后可达，终态 usage 决定 settle/release/review。
- [ ] 增加双用户数据库集成：同 workspace 两个 principal 独立 Run、credit hold、bill、usage、
  ledger；余额不足不调用 Provider，超级管理员形成 SYSTEM_FUNDED bill。
- [x] 在管理 UI 保留用户/角色入口，并显示 username；个人积分/账单接口继续按会话 principal
  查询，禁止管理员 UI 代替用户身份发起普通 Agent 调用。

Phase 6 gate：

```bash
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/worker test:unit
pnpm test:postgres
pnpm typecheck
```

## Scope 与回滚检查

- [ ] 只修改本任务允许的 contracts、10634/10635 migration/renderer、Web auth/CLI/UI、local
  runtime、定向测试、根脚本与 Runbook；不覆盖工作树中已有的无关改动。
- [ ] 不新增公开业务 auth route、客户端 role/principal 信任或生产自动同步。
- [ ] 回滚开关默认关闭；关闭后 `pnpm dev` 恢复原行为。username plugin 可从应用回滚，
  nullable 数据库字段、既有管理员和 audit 保留。
- [ ] `git diff --check` 与本任务文件 allowlist 检查通过。
