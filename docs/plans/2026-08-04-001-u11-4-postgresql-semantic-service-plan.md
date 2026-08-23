---
title: "U11.4 PostgreSQL 语义治理服务实现计划"
type: feature
date: 2026-08-04
origin: docs/brainstorms/2026-08-04-u11-4-postgresql-service-requirements.md
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
language: zh-CN
---

# U11.4 PostgreSQL 语义治理服务实现计划

## 问题界定

`SemanticGovernanceService` 当前使用 Mock 数据。需要替换为真实 PostgreSQL 查询，
使用 `10610 migration` 已安装的 `semantic.*` 表与 RPC 函数。

## 范围

**在范围内：**
- 添加 `@data-agent/platform` 为 `@data-agent/web` 的 workspace 依赖
- 创建 `PostgresSemanticGovernanceService` 实现（`apps/web/src/lib/`）
- 更新 `getSemanticGovernanceService()` 以支持 PostgreSQL 模式
- 所有 9 个服务方法对接真实数据库

**不在范围内：**
- 不改动前端 API 客户端（`semantic-api.ts`）
- 不改动服务接口定义
- 不改动 API 路由
- 不改动数据库 migration
- 不改动前端组件或 hooks

---

## 关键技术决策

1. **服务位置**: `apps/web/src/lib/postgres-semantic-governance-service.ts`
   - 理由：`SemanticGovernanceService` 接口定义在 `apps/web`，放在 `packages/platform` 会产生循环依赖
   - 后续可升级：将接口移到 `packages/contracts`，再将实现移到 `packages/platform`

2. **数据库连接**: 使用 `pg.Pool` + `adaptPgPool` 创建 `SqlPool`
   - 构造函数注入 `SqlPool`，保持可测试性
   - 不直接使用 `withAppTransaction` — 因其需要 `TransactionalCapabilityAuthorizer`（内部复杂类型）
   - 手动管理事务和 scope context

3. **RLS 策略**: 设置 `app.app_id` 和 `app.tenant_id` 上下文变量
   - `semantic.*` 表的 RLS 策略使用 `app.*` 设置
   - 需要 `BYPASSRLS` 权限或配置 RLS 策略

4. **RPC 调用**: 直接调用 `semantic.record_review_decision()` 等 RPC 函数
   - 通过 `SELECT semantic.record_review_decision(...)` 调用
   - 解析返回值中的 JSONB 结果

5. **状态映射**: 将 DB `candidate_status` 映射到前端 `ReviewPacketStatus`
   - 使用辅助函数进行状态转换

---

## Implementation Units

### U11.4.1: 添加 workspace 依赖

**Goal:** 使 `apps/web` 可以导入 `@data-agent/platform`

**Files:**
- Modify: `apps/web/package.json` — 添加 `"@data-agent/platform": "workspace:*"` 到 dependencies
- Modify: `apps/web/next.config.ts` — 添加 `"@data-agent/platform"` 到 `transpilePackages`

**Verification:** `pnpm install` 成功

---

### U11.4.2: 创建 PostgreSQL 服务实现

**Goal:** 实现 `SemanticGovernanceService` 接口的全部 9 个方法，对接 PostgreSQL

**Dependencies:** U11.4.1

**Files:**
- Create: `apps/web/src/lib/postgres-semantic-governance-service.ts`

**Keys:**
- `PostgresSemanticGovernanceService` 类实现 `SemanticGovernanceService` 接口
- 构造函数接收 `pool: SqlPool`
- 每个方法获取 client，设置 scope context，执行查询，映射结果
- 使用 `SET LOCAL` 设置 `app.app_id`, `app.tenant_id`, `app.environment`, `app.semantic_domain` 上下文
- 读操作使用 `SELECT` 查询
- 写操作使用 RPC 函数调用

**方法实现:**

1. `listDomains`: `SELECT semantic_domain, domain_display_name, domain_description, datasource_id, is_active, domain_version FROM semantic.semantic_domain_registry WHERE app_id = $1 AND tenant_id = $2 AND environment = $3 AND ($4 = 'all' OR semantic_domain = $4)`

2. `getInboxItems`: 查询 `semantic_review_task` 表，关联 `semantic_review_decision` 获取当前用户决策状态，使用 `packet_payload` 中的 JSONB 数据构造 `InboxItem`

3. `getPacketDetail`: 查询 `semantic_review_task` 表，解析 `packet_payload` JSONB，查询 `semantic_review_decision` 获取决策列表

4. `submitDecision`: `SELECT semantic.record_review_decision($1, $2, $3, $4, $5, $6, $7, $8, $9)` 解析返回的 JSONB

5. `createCandidate`: `INSERT INTO semantic.semantic_candidate` + `INSERT INTO semantic.semantic_candidate_revision`

6. `preparePublish`: `SELECT semantic.prepare_publish_attempt($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`

7. `commitPublish`: `SELECT semantic.commit_publish_attempt($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`

8. `executeRollback`: `SELECT semantic.execute_rollback($1, $2, $3, $4, $5, $6, $7)`

**Type mappings:**
- DB `candidate_status` → `ReviewPacketStatus`: `DRAFT/PUBLISHING/REVIEW_SUBMITTED/WAITING_REVIEW/VALIDATING/VALIDATION_FAILED → 'candidate'`, `APPROVED → 'approved-not-published'`, `REJECTED → 'rejected'`, `PUBLISHED → 'published'`, `STALE_REBASE_REQUIRED → 'stale'`
- DB `review_outcome` → `ReviewDecision`: `PENDING → 'pending'`, `APPROVED → 'approved'`, `VETOED/EXPIRED → 'rejected'`
- DB `semantic_role` → `SemanticRole`: `domain_reviewer/security_reviewer → 'human-reviewer'`, `admin_reviewer → 'admin'`

**Patterns to follow:**
- `apps/web/src/lib/semantic-governance-service.ts` — 接口定义和错误处理
- `packages/platform/src/persistence/transaction.ts` — `establishScope` 设置上下文变量的方式

**Test scenarios:**
- 每个方法正确处理数据库连接
- 类型映射正确转换所有状态值
- 错误处理：数据库错误 → `SemanticGovernanceError`

---

### U11.4.3: 更新服务工厂函数

**Goal:** 根据环境变量在 Mock 和 PostgreSQL 实现之间切换

**Dependencies:** U11.4.2

**Files:**
- Modify: `apps/web/src/lib/semantic-governance-service.ts` — 更新 `getSemanticGovernanceService()`

**Approach:**
- 检查 `process.env.USE_POSTGRES_SERVICE` 环境变量
- 如果为 `'true'`，创建 `PostgresSemanticGovernanceService` 实例
- 否则返回 Mock 实现（默认行为）
- 需要从环境变量或配置中获取 PostgreSQL 连接字符串

---

### U11.4.4: 类型验证

**Goal:** 确保所有类型正确，`pnpm typecheck` 通过

**Dependencies:** U11.4.1, U11.4.2

**Verification:**
- `pnpm install` 成功
- `pnpm typecheck` 通过（全 13 包无类型错误）

---

## 系统影响

- **依赖图**: `apps/web` 新增对 `@data-agent/platform` 的依赖
- **Next.js 配置**: `transpilePackages` 需要更新
- **数据库连接**: 需要配置 `DATABASE_URL` 环境变量
- **RLS 要求**: 数据库连接用户需要 `BYPASSRLS` 权限或配置 RLS 策略

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| RLS 策略阻止直接表查询 | 使用 `BYPASSRLS` 角色或添加 RLS 策略 |
| `packet_payload` JSONB 结构不匹配前端类型 | 仔细映射 JSONB 字段，添加验证 |
| RPC 函数参数复杂 | 严格按函数签名传递参数 |
| 数据库连接失败 | 优雅降级到 Mock 实现 |
