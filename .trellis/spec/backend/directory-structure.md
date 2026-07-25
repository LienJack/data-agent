# 后端目录与依赖结构

> 本规范约束 Data Agent Monorepo 的模块所有权和依赖方向。

## 场景：新增领域能力或平台适配器

### 1. 范围 / 触发条件

- 新增或修改 `packages/*`、`apps/*`、`services/*`、`infra/*` 时适用。
- 目标是让领域正确性独立于 Mastra、Next.js、Supabase、Redis 和 Python 运行时。

### 2. 签名与目录

```text
apps/
  web/                 # 短生命周期控制面与 Run Projection
  worker/              # 持久 Mastra Worker
packages/
  contracts/           # JSON 边界、Artifact、Port、终态
  text2sql/             # 查询编译与七道 Gate
  research/             # L2 研究与 ReportReady
  evals/                # Benchmark Transport 与独立 Oracle
  agent-runtime/        # Mastra、Provider、Team 适配
  platform/             # PostgreSQL、Redis、Storage、Queue 适配
services/
  sandbox/              # Python/SQL 隔离执行
tests/                  # 跨 Package 集成、E2E、部署测试
```

每个 TypeScript Package 至少导出：

```text
package.json
tsconfig.json
src/index.ts
test/*.spec.ts
```

### 3. 契约

- `contracts` 不得导入任何 App、Runtime 或平台 SDK。
- `text2sql`、`research`、`evals` 只依赖 `contracts` 和显式 Port。
- `agent-runtime` 可以适配 Mastra，但不能提交 SQL、Evidence 或 Release 真值。
- `platform` 实现 Port，不导入领域 Workflow。
- `apps` 只做组合与边界解析，不重新定义领域 Schema。
- Python 服务只通过版本化 Sandbox Protocol 交互。

### 4. 校验与错误矩阵

| 条件 | 结果 |
| --- | --- |
| `contracts` 导入 `@mastra/*`、`@supabase/*`、Redis 或 Next.js | Architecture Test 失败 |
| 领域 Package 直接导入平台 SDK | Architecture Test 失败 |
| App 在本地复制 Public Terminal 或 Artifact 类型 | Code Review/Type Test 失败 |
| 跨语言载荷未绑定 `schema_version` | Runtime Validation 失败 |
| L3–L5 出现 Workflow、Route 或 Tool | Capability Boundary Test 失败 |

### 5. Good / Base / Bad

- Good：`apps/worker` 注入 `ArtifactStorePort`，领域包只调用 Port。
- Base：叶子 Package 仅依赖 `@data-agent/contracts`。
- Bad：`packages/text2sql` 直接创建 Supabase Client 或 Mastra Agent。

### 6. 必需测试

- `packages/contracts/test/dependency-boundaries.spec.ts` 检查禁止导入。
- 每个 Adapter 运行同一 Port Conformance Fixture。
- 跨 TypeScript/Python 边界执行 Schema Round-Trip。
- 根级 `pnpm typecheck` 覆盖所有 Workspace。

### 7. Wrong vs Correct

#### Wrong

```ts
import { createClient } from "@supabase/supabase-js";
export async function compileQuery() {
  return createClient("url", "key");
}
```

#### Correct

```ts
import type { ArtifactStorePort } from "@data-agent/contracts";
export function createCompiler(store: ArtifactStorePort) {
  return { store };
}
```
