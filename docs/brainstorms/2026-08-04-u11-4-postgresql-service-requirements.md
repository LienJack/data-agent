---
title: "U11.4 PostgreSQL 语义治理服务需求文档"
type: requirements
date: 2026-08-04
origin: docs/plans/2026-07-30-001-refactor-governed-semantic-control-plane-plan.md
language: zh-CN
status: draft
---

# U11.4 PostgreSQL 语义治理服务

## 问题界定

当前 `SemanticGovernanceService` 使用 Mock 数据（`apps/web/src/lib/semantic-governance-service.ts`），
所有 domain 列表、收件箱、审核包详情、决策、发布和回滚操作都返回硬编码数据。
U11.1–U11.3 已完成接口定义、API 路由和权限 UI，但数据层尚未对接真实数据库。

10610 migration 已安装到 PostgreSQL，包含 `semantic.*` 下的 31 张表以及
`record_review_decision`、`prepare_publish_attempt`、`commit_publish_attempt`、
`execute_rollback` 四个 RPC。需要将 Mock 实现替换为真实 PostgreSQL 查询。

## 范围

**在范围内：**

1. 在 `packages/platform/src/governance/` 下创建 `PostgresSemanticGovernanceService`
2. 添加 `@data-agent/platform` 为 `@data-agent/web` 的 workspace 依赖
3. 实现 `SemanticGovernanceService` 接口的全部 9 个方法
4. 更新 `getSemanticGovernanceService()` 以返回 PostgreSQL 实现
5. 使用 `withAppTransaction` 进行所有数据库操作
6. 数据库类型到前端类型的映射

**不在范围内：**

- 不改动前端 API 客户端（`semantic-api.ts`）
- 不改动 `SemanticGovernanceService` 接口定义
- 不改动 API 路由（7 个 route files）
- 不改动数据库 migration（10610 已完成）
- 不改动前端组件或 hooks

## 数据映射

### 表 → 服务方法映射

| 服务方法 | 数据库表 / RPC |
|---------|---------------|
| `listDomains` | `semantic.semantic_domain_registry` |
| `getInboxItems` | `semantic.semantic_review_task` + `semantic.semantic_review_decision` |
| `getPacketDetail` | `semantic.semantic_review_task` + `semantic.semantic_review_decision` + `semantic.semantic_candidate` |
| `submitDecision` | `semantic.record_review_decision()` RPC |
| `createCandidate` | `semantic.semantic_candidate` + `semantic.semantic_candidate_revision` |
| `preparePublish` | `semantic.prepare_publish_attempt()` RPC |
| `commitPublish` | `semantic.commit_publish_attempt()` RPC |
| `executeRollback` | `semantic.execute_rollback()` RPC |

### 状态映射

| DB 字段 | DB 值 | 前端类型 |
|---------|-------|---------|
| `candidate_status` | `DRAFT` | `candidate` |
| `candidate_status` | `REVIEW_SUBMITTED` / `WAITING_REVIEW` | `candidate` |
| `candidate_status` | `APPROVED` | `approved-not-published` |
| `candidate_status` | `REJECTED` | `rejected` |
| `candidate_status` | `PUBLISHED` | `published` |
| `candidate_status` | `STALE_REBASE_REQUIRED` | `stale` |
| `candidate_status` | `VALIDATING` / `VALIDATION_FAILED` / `PUBLISHING` | `active` |
| `review_outcome` | `PENDING` | `pending` |
| `review_outcome` | `APPROVED` | `approved` |
| `review_outcome` | `VETOED` | `rejected` |
| `review_outcome` | `EXPIRED` | `rejected` |

### 角色映射

| DB `semantic_role` | 前端 `SemanticRole` |
|-------------------|-------------------|
| `domain_reviewer` | `human-reviewer` |
| `security_reviewer` | `human-reviewer` |
| `admin_reviewer` | `admin` |
| (agent proposer — 无 DB 角色) | `agent-proposer` |
| (publisher — 无 DB 角色) | `publisher` |

## 成功标准

1. `pnpm typecheck` 通过（全 13 包无类型错误）
2. 所有 9 个服务方法从 PostgreSQL 而非 Mock 返回数据
3. 读操作（listDomains, getInboxItems, getPacketDetail）使用 `READ` 权限
4. 写操作（submitDecision, createCandidate, preparePublish, commitPublish, executeRollback）
   使用 `WRITE` 权限
5. RPC 调用（record_review_decision, prepare_publish_attempt, commit_publish_attempt,
   execute_rollback）正确传递参数并处理结果
6. 错误处理：数据库错误 → `SemanticGovernanceError`，404 返回 `PACKET_NOT_FOUND`

## 依赖

- `packages/platform` 已导出 `withAppTransaction`、`SqlPool`、`SqlClient`
- `apps/web` 需要添加 `@data-agent/platform` 依赖
- `10610 migration` 已安装并可用
