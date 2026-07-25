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
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | To fill |
| [错误与终态](./error-handling.md) | Reason Code、公开终态与失败关闭 | 已建立 |
| [Artifact 权威与内容寻址](./artifact-authority.md) | Candidate、Hash、Reference 与成功态授权 | 已建立 |
| [Port Conformance](./port-conformance.md) | Scope、幂等、Lease/Fence 与非权威 Cache | 已建立 |
| [质量规范](./quality-guidelines.md) | 类型、测试、边界与审查门禁 | 已建立 |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |

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
