# 统一 Runtime Config

## Goal

建立 Web、Worker 和 CLI 共用的 Runtime Config 边界，唯一处理根 dotenv 和历史环境变量别名。

## Requirements

- 规范变量优先，旧别名只在统一边界提升，不覆盖显式规范值。
- 覆盖 DeepSeek、Moonshot/Kimi、GLM 等当前实际别名，不允许业务模块继续直接读取旧名。
- dotenv 加载、repo root 解析和 typed config normalization 有清晰 server-only 边界。
- 保持容器/Host 显式环境注入权威，不泄露 secret value。
- 为旧别名命中提供安全诊断和账本 removal condition。

## Acceptance Criteria

- [ ] 搜索证明生产源码仅统一模块读取旧别名。
- [ ] Web、Worker、Semantic Authoring、Certification 和本地 runtime 配置测试通过。
- [ ] 规范值优先、别名 fallback、缺失值、不同 cwd 和幂等加载均有测试。
- [ ] scoped commit 并归档子任务。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
