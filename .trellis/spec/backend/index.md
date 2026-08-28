# 后端开发规范

> Data Agent 后端与领域内核的可执行约定。

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [目录与依赖结构](./directory-structure.md) | Monorepo 模块所有权与依赖方向 | 已建立 |
| [数据库与共享 Supabase](./database-guidelines.md) | Authority、RLS、事务、Migration、Lifecycle | 已建立 |
| [旧权威后继发布闭包](./legacy-authority-forward-migrations.md) | exact-scope 前向 Migration、人工审批、依赖 fence 与 populated-upgrade hash Oracle | 已建立，10793-10794 验证 |
| [错误与终态](./error-handling.md) | Reason Code、公开终态与失败关闭 | 已建立 |
| [Artifact 权威与内容寻址](./artifact-authority.md) | Candidate、Hash、Reference 与成功态授权 | 已建立 |
| [Port Conformance](./port-conformance.md) | Scope、幂等、Lease/Fence 与非权威 Cache | 已建立 |
| [Test Center 与系统模型](./benchmark-test-center.md) | 环境模型、题库安装、密封 Oracle、反省与 Holdout 发布门禁 | 已建立 |
| [Falcon Agent Release Gate](./falcon-agent-release-gate.md) | 28 库/500 题 Agent Team、隔离、恢复、冷启动与绝对发布门禁 | 已建立 |
| [Semantic Relationship Index](./semantic-relationship-index.md) | PostgreSQL 权威、Neo4j 投影、搜索回退与索引器闭环 | 已建立 |
| [工作空间、身份与商业归档权威](./workspace-identity.md) | Workspace Scope、RBAC、幂等命令和历史商业表只读边界 | 已建立，10703 已冻结 |
| [Model Control 边界](./model-control.md) | Provider、Model、SecretRef 元数据与技术就绪的非商业控制面 | 已建立 |
| [商业计费退役记录](./billing-retirement.md) | 无商业计费运行时、历史数据库冻结与禁止兼容恢复 | 已建立 |
| [退役 Surface 与兼容债务](./retirement-surfaces.md) | 全仓退役账本、兼容面门禁与可靠性 fallback 分类 | 已建立 |
| [Q&A 对话资源绑定](./qa-conversation-resource-binding.md) | Composer、Conversation 冻结、Run 快照与直接分析执行 | 已建立，五项真实门禁通过 |
| [Q&A 管理员审计平面](./qa-admin-audit-plane.md) | 跨 owner 只读 projection、不可变回执、Admin SSE 与 Artifact 双门禁 | 已建立 |
| [Provider Invocation Authority](./provider-invocation-authority.md) | 当前轻量直连与历史 Intent/Permit 兼容边界 | 已建立，生产直连 |
| [统一 Job Center](./job-center.md) | 后台 Job、Lease/Fence、Handler Heartbeat 与 Capability Readiness | 已建立 |
| [Knowledge Base Authority](./knowledge-base.md) | U6 File 到 U10 索引、Neo4j 投影、检索证据与 U2 冻结 | 已建立 |
| [Semantic Induction Maintenance](./semantic-induction-maintenance.md) | U10 Job 到 U5 review-only Candidate 的稳定归纳、漂移影响与 Metric dry-run | 已建立 |
| [Resolved Context Authority](./resolved-context-authority.md) | Request/Snapshot/Package/Receipt 身份闭包、能力路由与 Preview/Worker 共用解析 | 已建立 |
| [Resolved Context Text2SQL Authority](./text2sql-resolved-context.md) | Context/Mapping/Compiler/Graph/SQL Firewall 的执行闭包 | 已建立 |
| [MCP / Skill Extension Authority](./extension-runtime.md) | Registry、Effective Config、Tool Effect、SSRF Transport 与 Semantic MCP | 已建立 |
| [Session Recovery Authority](./session-recovery.md) | Interruption、原子 Reply+Resume 与引用式 Session Branch | 已建立 |
| [Resolution Trace 与 SQL History](./resolution-trace.md) | Event/Artifact 重验、公开轨迹、SQL 哈希索引与原会话深链 | 已建立 |
| [本地开发与 Docker 运行模式](./local-runtime-modes.md) | 数据库容器、本地 watch、完整部署与迁移门禁 | 已建立 |
| [Python Sandbox 执行](./python-sandbox-execution.md) | 模型 Python 源码、隔离运行、统计算子 Registry、资源预算、Receipt 与失败关闭 | 算子运行链已实现，Agent/E2E HOLD |
| [质量规范](./quality-guidelines.md) | 类型、测试、边界与审查门禁 | 已建立 |
| [日志、审计与脱敏](./logging-guidelines.md) | Structured Log、Audit 与 Secret Boundary | 已建立 |
| [Run 公开事件流](./run-event-streaming.md) | Durable SSE、公开事件 DTO、对话轨迹与前端装配 | 已建立 |
| [Agent Team Product Runtime](./agent-team-runtime.md) | Product Profile、Skill、Team 命令、专职 Tool 与 Acceptance 边界 | 已建立 |
| [Datasource Adapter Runtime](./datasource-adapters.md) | 五类 Registry、方言 Firewall、只读 Transport 与认证报告 | 已建立 |
| [Model API Authentication](./model-api-authentication.md) | 可选的模型连通性诊断；不参与生产调用 readiness | 已建立 |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**语言**：项目文档以中文为主，保留必要的英文标识、类型名和命令。
