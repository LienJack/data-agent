# Datasource Adapter Registry And Runtime

## 1. Scope / Trigger

- 修改 Datasource 类型、Gallery 字段、Schema Scan、方言 Firewall、只读 Transport 或 Adapter 认证时适用。
- Workspace Datasource Revision/SecretRef/PostgreSQL 表仍是连接配置 Authority；Registry 只描述部署能力。
- mandatory set 固定 `clickhouse,duckdb,mysql,postgresql,sqlite`，Trino 不可作为 fallback。

## 2. Signatures

```ts
buildDatasourceAdapterDescriptor(input): Promise<DatasourceAdapterDescriptor>;
buildDatasourceAdapterCertification(input): Promise<DatasourceAdapterCertification>;
createDatasourceAdapterRegistry({ descriptors, certifications }).snapshot();
createGovernedDatasourceAdapter({ descriptor, target_authority, validate_statement, transport });
adapter.scanSchema(request, signal);
adapter.execute(request, signal);
```

```text
GET /api/workspaces/{workspaceId}/datasource-adapters
@data-agent/platform/datasource-adapters  # Worker-only native transports
```

## 3. Contracts

- Descriptor 绑定 Adapter ID/revision/hash、dialect、topology、动态 fields、精确 driver/parser version/license 与文档地址。
- 能力固定按 `CONNECTION -> SCHEMA_SCAN -> GOVERNED_QUERY` 单调升级；`GOVERNED_QUERY` 必须有 exact READY certification。
- Certification 完整包含 `BYTE_LIMIT,CONNECTION,EXPLAIN,READ_ONLY,ROW_LIMIT,SCHEMA_SCAN,SECRET_REDACTION,SINGLE_STATEMENT,TARGET_SCOPE,TIMEOUT` 十项 PASS 与 evidence hash。
- Query/Scan Request 绑定完整 App scope、Datasource ID、exact Adapter ref、target capability hash 和限制；跨 dialect/revision 失败。
- Target Authority 在 parser、EXPLAIN、catalog scan 和 execute 前消费 Egress/File capability；拒绝时所有 transport 调用数为 0。
- 网络 Adapter 使用 pinned address + original server name + CA；MySQL 使用显式 TLS stream，ClickHouse 使用 HTTPS Agent，不能重新 DNS。
- SQLite 使用 `readOnly + query_only + defensive + extension disabled`；DuckDB 使用 read-only instance、native statement extraction 且 external access disabled。
- `@data-agent/platform` 包根不得导出 native DuckDB transport。Native driver 只从 Worker 子路径 `@data-agent/platform/datasource-adapters` 导入，防止 Next/Edge 静态追踪跨平台 binary。

## 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| mandatory set 缺失/多余/乱序 | `DATASOURCE_ADAPTER_MANDATORY_SET_INCOMPLETE` |
| descriptor/certification/request hash 漂移 | 对应 `*_HASH_MISMATCH` |
| certification 与 descriptor 不同 revision/hash | `DATASOURCE_ADAPTER_CERTIFICATION_STALE` |
| Adapter ID/dialect/revision 换绑 | `DATASOURCE_ADAPTER_BINDING_MISMATCH` |
| Target capability 不匹配/拒绝 | `DATASOURCE_ADAPTER_TARGET_MISMATCH` 或 Authority 原错误，零 I/O |
| 写语句、多语句、危险函数、越权 relation | `DATASOURCE_ADAPTER_*_REJECTED`，零 explain/execute |
| 超时、row/byte/schema object 超限 | 对应 `*_TIMEOUT` / `*_LIMIT_EXCEEDED`，不释放 partial result |
| native transport 从 Platform 根导出 | Next build/native binding gate 失败 |

## 5. Good / Base / Bad Cases

- Good：Registry 返回五份 exact READY report；Worker 消费已批准 target，方言 parser 通过后 explain，再在只读边界执行并签发 hashed result。
- Base：Adapter 无认证时 Gallery 可显示 descriptor，但 effective capability 为 BLOCKED，不能用于新 Run。
- Bad：Web 本地复制类型/字段、把 CONNECTION 当 GOVERNED_QUERY、用 MySQL parser best-effort 解析 ClickHouse，或从 Platform 根导出 DuckDB binding。

## 6. Tests Required

- Contracts：descriptor/request/result/scan/certification canonical hash、完整顺序、跨 dialect 与 count/hash tamper。
- Platform：五 Adapter read/write/multi/function/relation、target zero-I/O、timeout、row/byte、schema scan 与 Registry all-or-nothing。
- Integration：SQLite 与 DuckDB 使用真实临时只读文件；PostgreSQL/MySQL/ClickHouse transport 断言 read-only/TLS/SNI/EXPLAIN/settings。
- PostgreSQL 17：10668 exact type CHECK 含五 mandatory 且不含 Trino。
- Web：Route strict snapshot、Gallery 五项/三能力、loading/error、桌面/390px 无横向溢出。

## 7. Wrong vs Correct

### Wrong

```ts
const adapter = configs[input.type] ?? configs.postgresql;
await adapter.execute(input.sql);
```

### Correct

```ts
const request = await verifyGovernedDatasourceQueryRequest(input);
const target = await targetAuthority.authorize(request);
if (!target.ok) return target;
await dialectPolicy(request);
await transport.explain({ request, target: target.value.target, signal });
return transport.execute({ request, target: target.value.target, signal });
```
