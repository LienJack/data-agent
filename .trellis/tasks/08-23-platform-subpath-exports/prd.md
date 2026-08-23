# Platform 子路径出口治理

## Goal

用职责子路径和增量门禁收缩 `@data-agent/platform` 根公共面，停止应用继续依赖万能 barrel。

## Requirements

- 提供 persistence、runs、semantic-postgres、sandbox、storage、tenancy、runtime-config 等稳定子路径。
- 新增生产源码不得从 Platform 根出口导入；现有根导入冻结为可递减基线。
- 本目标已修改的消费者必须迁移到子路径。
- 子路径不改变 runtime behavior，不复制 implementation，不泄露 internal-only transaction/authority 类型。
- 暂不按目录机械拆 npm 包；物理拆包必须由独立依赖和消费者证据驱动。

## Acceptance Criteria

- [ ] package exports、构建声明和源码入口一致，关键 symbols 有 conformance tests。
- [ ] 架构门禁拒绝新增根导入并允许基线递减。
- [ ] 受影响 Web/Worker/Platform build/typecheck/unit/contract/architecture tests 通过。
- [ ] scoped commit 并归档子任务。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
