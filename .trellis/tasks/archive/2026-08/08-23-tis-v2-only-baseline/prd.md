# M0 V2-only 采用基线

## Goal

将现有 TIS 方案改写为单版本执行基线，删除所有 V1/V2 共存、双读、回退和旧数据迁移要求。

## Requirements

- 以用户最终决策覆盖计划草案：只保留当前语义版本，无 V1/V2 共存、shadow dual-compute、fallback adapter、
  deprecated export 或旧数据迁移。
- 保留 TIS 参考快照、采用/拒绝矩阵、PostgreSQL authority、Candidate-only 与安全投影边界。
- 区分“可选投影故障回到当前 lexical authority”和“回到旧实现”；前者允许，后者禁止。
- 固定已提交前置基线 `858446e`，后续任务不得在未归属修改上施工。

## Acceptance Criteria

- [x] 主方案和 M0–M4 文档不再要求 V1/V2 并存、双读、兼容映射、旧 consumer fallback 或数据迁移。
- [x] 版本、发布与回滚章节明确 current-only 替换策略及无数据迁移边界。
- [x] M1/M3/M4 的目标文件、测试和完成定义均以唯一当前契约表达。
- [x] 文档链接和格式检查通过，任务以 scoped commit 完成。

## Notes

- 本任务只修改计划/任务文件，不修改运行时代码。
- 父任务：`08-23-tis-directed-semantic-refactor`。
- 该方案已由用户明确要求参考后执行；本任务完成后进入 M1。
