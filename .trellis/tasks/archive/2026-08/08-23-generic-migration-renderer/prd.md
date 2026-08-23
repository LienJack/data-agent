# 通用迁移渲染器

## Goal

用声明式 manifest 和统一 CLI 替代常规迁移的重复渲染实现，同时保持所有已发布 SQL 字节不变。

## Requirements

- 通用渲染器统一负责 segment closure、换行、placeholder、checksum header、ledger checksum 和 `--verify`。
- Manifest 必须明确 migration name、source directory、segments、placeholder、checksum header 和可选 postcondition。
- 迁移全部常规 renderer；只保留确实需要旧函数抽取、结构变换或专用安全断言的例外脚本。
- 不重命名、不重排、不修改已执行 SQL；7 组重复序号和其他 grandfather 集合不得增加。
- 更新脚本调用方、文档和测试，不通过长期 wrapper 假装旧入口仍然存在。

## Acceptance Criteria

- [x] 通用 renderer 的单元测试覆盖生成、verify、segment drift、placeholder drift 和 checksum drift。
- [x] 迁移后的每个 SQL 与实施前 Git 内容字节一致。
- [x] 常规独立 renderer 数量显著收缩，剩余例外有显式原因和测试。
- [x] migration inventory、相关 PG 静态测试、Biome/typecheck 通过并创建 scoped commit。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
