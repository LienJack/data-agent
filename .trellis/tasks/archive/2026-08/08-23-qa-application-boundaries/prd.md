# Q&A 应用编排与 Store 拆分

## Goal

将 Q&A Run 创建用例和流式恢复状态从 Next Route 与单体 Zustand Store 中抽离到可测试的唯一应用边界。

## Requirements

- Route 只负责 transport、输入解析、授权入口和 HTTP projection，不直接装配完整 PostgreSQL 用例。
- Run 创建的资源冻结、catalog、config、acceptance 和投影读取由单一 server use-case 拥有。
- `qa-store.ts` 中 SSE cursor/reconnect/reducer 逻辑抽为独立模块；`sequence` 仍是唯一恢复和去重游标。
- 不改变当前 URL、公开 DTO、错误码、权限检查、事务边界和 UI 行为。
- 不新增兼容 route、并行 Store 或第二套事件状态机。

## Acceptance Criteria

- [x] Route 通过注入 use-case 测试 transport 行为；use-case 独立覆盖成功和关键失败。
- [x] SSE 状态模块覆盖 replay、duplicate、reconnect、terminal 和 abort。
- [x] 现有 Q&A/Web 单元测试、typecheck/build 通过，浏览器/API 行为无回归。
- [x] scoped commit 并归档子任务。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
