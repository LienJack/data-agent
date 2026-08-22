# 语义与知识工作台重构

## Goal

统一 Semantic Studio、Explorer、Review、Physical Schema 和 Knowledge 的蓝色多栏工作台体验，保持关系优先语义模型与发布权威。

## Requirements

- Studio 使用对象上下文、主工作区、Inspector 三层结构；Agent 仍是主要创作入口。
- Explorer/Schema/Knowledge 使用适合数据工作台的 Split View，不套通用卡片。
- Candidate 与 Published 通过状态与 authority 文案区分，不把主题色当业务状态。
- 保留 typed operations、Evidence Selection、revision、release 与 read-only 边界。

## Acceptance Criteria

- [ ] Semantic/Knowledge 核心页面在桌面和 390px 可操作且无横向页面溢出。
- [ ] Graph/List/Inspector 选中与焦点使用统一蓝色。
- [ ] 相关 unit、typecheck、build 与 scoped commit 通过。

## Out Of Scope

- 不修改 Node/Edge 元模型、PostgreSQL authority、Neo4j projection 或发布流程。
