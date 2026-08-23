# Better Auth Compatibility Lock

## Locked dependency

- Package: `better-auth@1.6.23`（精确版本，不使用 range）
- License: MIT
- Database: 复用 `pg@8.22.0` PostgreSQL Pool，认证表位于私有非默认 schema
- Framework: package peer range包含 Next `^16.0.0` 与 React `^19.0.0`
- Runtime: package 未声明 Node `engines`；Node 26 兼容性不能只靠 metadata 宣称，必须由
  本仓库 Node 26 下 install、typecheck、unit test 和 Next build 证明

## Official capability evidence

- PostgreSQL adapter 支持 CLI generate/migrate 和非默认 schema。
- Next.js integration 明确支持 Next 16 `proxy.ts` 与 App Router route handler。
- email/password 提供 `disableSignUp`；session 使用数据库 Cookie session 并支持 revoke。
- Admin plugin 提供 create user、set password、ban/unban、list/revoke sessions。
- 本项目不把 Better Auth admin role 作为业务 RBAC 权威，也不暴露 impersonation。

## Generation boundary

Better Auth CLI 只用于从锁定配置生成 SQL 候选。候选必须人工审查、纳入 Data Agent 10627
migration checksum 并由现有 migration runner 执行；应用启动不得调用自动 migrate。
