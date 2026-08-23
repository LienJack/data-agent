# 电商 Demo Benchmark 隔离

## Goal

把电商销售意图、SQL 编译和呈现规则从通用 Worker/Platform 核心迁移到显式 Demo/Benchmark capability adapter。

## Requirements

- 通用 Run Workflow 不得硬编码 `SALES_REPORT`、BRL、电商表或电商异常阈值。
- 电商能力通过显式 catalog/adapter 注册，只在匹配 Workspace/Semantic Release/benchmark profile 时启用。
- 通用权限、只读 SQL firewall、Artifact/Evidence、Resolved Context 和 acceptance 边界保持不变。
- 不能用通用 fallback 静默启用 Demo；未注册时失败关闭或进入通用模型路径。
- Falcon 与电商 Eval 的现有入口和固定数据验证保持可运行。

## Acceptance Criteria

- [ ] 静态架构测试证明通用 Worker/Platform 不再拥有电商业务常量和 SQL。
- [ ] adapter 注册、适用/不适用、未注册和错误传播均有测试。
- [ ] 电商 Demo focused suite、Worker unit/typecheck/build 通过。
- [ ] scoped commit 并归档子任务。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
