# 两阶段架构债治理

## Goal

在不改变 PostgreSQL、Published Semantic Release、权限和 fail-closed 权威边界的前提下，按已批准顺序完成两阶段架构债治理，降低公共面、迁移工具、应用编排和历史兼容层的持续膨胀风险。

## Requirements

- 第一阶段必须先完成并验证：全仓退役账本、通用迁移渲染器、Contracts 子路径出口治理。
- 第二阶段只能在第一阶段全部完成后开始：Q&A 应用边界、统一 Runtime Config、Demo/Benchmark 隔离、Platform 子路径出口治理。
- 每个子任务必须独立验证、仅暂存自有路径并创建一个 scoped commit。
- 不重命名或重写已经执行的迁移；历史重复序号与不可验证 checksum 只能冻结，不能扩张。
- 可靠性 fallback、PostgreSQL 权威、Semantic V2-only、RBAC、Artifact/Evidence 和公开事件脱敏边界必须保持不变。
- 不通过新增 compatibility wrapper、双写、redirect、隐藏 feature flag 或并行状态机完成重构。
- 保留主工作树中现有未提交任务和 Falcon 产物，实施在隔离 worktree 中进行，最后安全合并回 `dev`。

## Acceptance Criteria

- [ ] 七个子任务按指定顺序完成、验证并提交。
- [ ] 新增兼容面、Contracts 根导入和 Platform 根导入均有机器可检查的增量门禁。
- [ ] 通用迁移渲染器覆盖常规渲染路径，独立渲染脚本只保留确有自定义变换的例外。
- [ ] Q&A Route/Store 不再独占完整用例编排与 SSE 状态机职责。
- [ ] 旧环境变量别名只在唯一 Runtime Config 边界归一化。
- [ ] 电商销售意图、SQL 与呈现逻辑不再属于通用 Worker/Platform 核心职责。
- [ ] 受影响包的 build、typecheck、unit/contract/architecture tests 通过；全范围检查无未解释回归。
- [ ] 隔离分支合并回 `dev` 后，主工作树原有未提交路径得到恢复和逐路径比对。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
