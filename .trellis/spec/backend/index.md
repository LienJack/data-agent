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
| [错误与终态](./error-handling.md) | Reason Code、公开终态与失败关闭 | 已建立 |
| [Artifact 权威与内容寻址](./artifact-authority.md) | Candidate、Hash、Reference 与成功态授权 | 已建立 |
| [Port Conformance](./port-conformance.md) | Scope、幂等、Lease/Fence 与非权威 Cache | 已建立 |
| [Test Center 与系统模型](./benchmark-test-center.md) | 环境模型、题库安装、密封 Oracle、反省与 Holdout 发布门禁 | 已建立 |
| [Semantic Relationship Index](./semantic-relationship-index.md) | PostgreSQL 权威、Neo4j 投影、搜索回退与索引器闭环 | 已建立 |
| [本地开发与 Docker 运行模式](./local-runtime-modes.md) | 数据库容器、本地 watch、完整部署与迁移门禁 | 已建立 |
| [Python Sandbox 执行](./python-sandbox-execution.md) | 模型 Python 源码、隔离运行、资源预算、Receipt 与失败关闭 | 设计冻结，未实现 |
| [质量规范](./quality-guidelines.md) | 类型、测试、边界与审查门禁 | 已建立 |
| [日志、审计与脱敏](./logging-guidelines.md) | Structured Log、Audit 与 Secret Boundary | 已建立 |
| [Run 公开事件流](./run-event-streaming.md) | Durable SSE、公开事件 DTO、对话轨迹与前端装配 | 已建立 |

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
