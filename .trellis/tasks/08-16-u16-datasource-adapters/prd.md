# U16 Datasource Gallery 与分批 Adapter 认证

## Goal

在现有 Workspace Datasource Authority 上建立由公共 Capability/Field Schema 驱动的 Gallery，并为 PostgreSQL、
MySQL、SQLite、DuckDB、ClickHouse 提供互相独立、失败关闭的 `GOVERNED_QUERY` Adapter 认证面。

## Requirements

1. mandatory adapter set 固定为 PostgreSQL、MySQL、SQLite、DuckDB、ClickHouse；Trino 不进入 Registry 或 Gallery。
2. 公共 Registry DTO 冻结 Adapter identity、category、field schema、default、capability level、driver/parser/version、
   topology、documentation ref、certification state/hash，不存连接配置或 Secret。
3. Capability 按 `CONNECTION -> SCHEMA_SCAN -> GOVERNED_QUERY` 单调分级；只有完整认证 Report 为 READY 的 Adapter
   才能声明 `GOVERNED_QUERY`。
4. 网络型 Adapter 只接收已验证/已消费的 Egress Target 与 scoped SecretRef；文件型只接收 allowlisted inode/file
   capability，拒绝路径逃逸、extension/external access 与任意 attach。
5. 每个方言独立 parser/firewall/read-only/explain/timeout/row-byte/result normalization；禁止跨方言 best-effort parser。
6. 执行请求、Permit、SqlArtifact 与 Receipt 增加 dialect/adapter revision binding，不能只靠 datasource ID 推断。
7. Web 从 Contracts Registry 渲染类型选择、字段、required/default/SSL 和 capability 状态；不再本地复制 Registry。
8. 连接测试/保存/扫描继续进入同一 Workspace Datasource API；未部署的运行时能力显示 BLOCKED，不伪造 success。
9. U16 不运行 Falcon、不调用 Provider，不使用真实生产 Secret；集成测试使用隔离容器/临时文件与注入 transport。

## Acceptance Criteria

- [ ] 五个 mandatory Adapter 的 Registry identity、字段与版本精确且互不混淆，Trino 不可见。
- [ ] PostgreSQL/MySQL/SQLite/DuckDB/ClickHouse 分别拒绝写语句、多语句、越权对象、超时与结果超限。
- [ ] 网络/文件 Adapter 的 Egress/File capability 在 I/O 前校验，拒绝后底层调用数为 0。
- [ ] Certification Report 绑定 Adapter/driver/parser/firewall/runtime/fixture hash；缺一项不为 READY。
- [ ] Gallery 动态渲染五类表单与 capability 状态，桌面/390px/键盘无溢出。
- [ ] Contracts/Platform/Web focused/full relevant、typecheck/build、Biome、真实隔离 Adapter smoke 与 Trellis check 通过。

## Notes

- 固定版本：`pg@8.22.0`、`pgsql-parser@18.1.1`、`mysql2@3.23.2`、`node-sql-parser@5.4.0`、
  `@duckdb/node-api@1.5.2-r.2`、`@clickhouse/client@1.20.0`。
- Node 运行范围为 24–26；SQLite 使用内置 `node:sqlite`，不引入 native `better-sqlite3`。
- Certification Compose 固定 `mysql:8.4.11@sha256:b3b90af2...fd3fb` 与
  `clickhouse/clickhouse-server:25.8@sha256:f3f6c013...59e34` 的 multi-arch OCI digest。
- 共享工作树存在其他前端、登录、Billing 与 Demo 改动，提交只暂存 U16 owned paths/hunks。
