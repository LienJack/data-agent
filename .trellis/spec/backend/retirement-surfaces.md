# 退役 Surface 与兼容债务

> 全仓兼容面只有一个机器权威；可靠性 fallback 与迁移债务必须分开处置。

## 场景：新增或修改兼容、历史或 fallback 面

### 1. Scope / Trigger

- 生产源码新增 @deprecated API、legacy/compat 导出、旧环境变量别名或测试专用分支时触发。
- 修改 Text2SQL 历史夹具、迁移历史豁免、PostgreSQL/Neo4j fallback 时触发。
- 当前权威位于 docs/architecture/retirement-surface-ledger.json；其他文档只能解释，不能复制清单。

### 2. Signatures

账本固定为 retirement-surface-ledger@1.0.0：

```ts
interface RetirementSurfaceEntry {
  surface: string;
  kind: string;
  owner: string;
  introduced_at: string;
  current_consumers: string[];
  disposition:
    | "KEEP_CURRENT"
    | "KEEP_RELIABILITY_FALLBACK"
    | "MIGRATE_THEN_DELETE"
    | "ARCHIVE_TEST"
    | "DELETE"
    | "FROZEN_HISTORY";
  removal_condition: string;
  deadline: string | null;
  replacement: string;
  evidence: string[];
  status: "ACTIVE" | "PLANNED" | "ARCHIVED" | "REMOVED" | "FROZEN";
}
```

### 3. Contracts

- JSON 使用严格对象 Schema；未知字段、空 owner、空 removal_condition 和非法枚举拒绝。
- MIGRATE_THEN_DELETE、ARCHIVE_TEST、DELETE 的未完成项必须有 ISO 日期 deadline。
- KEEP_CURRENT、KEEP_RELIABILITY_FALLBACK、FROZEN_HISTORY 的 deadline 必须为 null。
- kind=RELIABILITY 只能使用 KEEP_RELIABILITY_FALLBACK，并提供测试证据。
- status=REMOVED 时 current_consumers 必须为空。
- 迁移具体 stem/checksum allowlist 仍由 workspace-migration-inventory.ts 唯一维护。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 未登记的生产 @deprecated、LEGACY_TEST_ONLY 或旧环境变量别名 | Architecture Test 失败 |
| 重复 surface 或未知字段 | 严格解析/账本校验失败 |
| 可靠性 fallback 被标成迁移债务 | 账本校验失败 |
| 未完成退役项缺 deadline | 账本校验失败 |
| 新迁移复制历史豁免 | Migration Inventory 失败 |

### 5. Good / Base / Bad

- Good：先登记 owner、消费者、退出条件、日期和证据，再引入临时兼容面。
- Base：历史只读契约登记为 FROZEN_HISTORY，健康当前面不伪装成兼容层。
- Bad：因为名称含 fallback 就删除 PostgreSQL 权威降级路径，或用第二份 Markdown 表复制清单。

### 6. Tests Required

- tests/semantic-billing-surface-ledger.spec.ts 必须覆盖严格解析、重复项、非法处置和伪造兼容 alias。
- 全仓生产源码扫描结果必须为空。
- reliability 条目必须断言 KEEP_RELIABILITY_FALLBACK 与测试证据。
- 迁移豁免仍运行 tests/workspace-migration-inventory.spec.ts。

### 7. Wrong vs Correct

#### Wrong

```ts
/** @deprecated */
export const oldEntry = currentEntry;
```

#### Correct

```ts
// 先在 retirement-surface-ledger.json 登记完整退出契约，再添加临时别名。
/** @deprecated Use currentEntry. */
export const oldEntry = currentEntry;
```
