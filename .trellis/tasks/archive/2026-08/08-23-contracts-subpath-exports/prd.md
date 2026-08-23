# Contracts 子路径出口治理

## Goal

通过领域子路径和增量架构门禁收缩 `@data-agent/contracts` 根公共面，停止新增全仓根耦合。

## Requirements

- 提供 artifacts、runs、semantic、workspaces、providers、ports 等稳定子路径出口。
- 新增生产源码不得从 `@data-agent/contracts` 根出口导入；现有根导入冻结为可递减基线。
- 至少迁移本目标后续会修改的消费者到对应子路径。
- 子路径只能暴露所属领域 API，不得引入新的跨领域循环或 server-only 泄漏。
- 保持现有根出口运行兼容，本子任务不要求一次迁移全部历史消费者。

## Acceptance Criteria

- [x] package exports、声明输出和源码入口一致。
- [x] 架构测试拒绝新增根导入、允许基线递减并拒绝基线扩张。
- [x] 子路径 conformance 测试覆盖关键 symbol。
- [x] contracts build/typecheck/unit/contract 与 workspace architecture tests 通过并提交。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
