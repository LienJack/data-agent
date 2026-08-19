# Team Agent 公开状态事件合同

## Goal

建立可持久、可重放、可脱敏的 Team Agent 状态与 Tool identity 公共事件合同，为 Worker 和 Web 提供唯一状态语言。

## Requirements

- 新增 strict `run.agent_status` runtime/public event，profile 仅允许三个 specialist。
- 状态闭集为 `PENDING/RUNNING/COMPLETED/FAILED/INTERRUPTED/SKIPPED/BLOCKED`。
- payload 包含 `profile_id/task_id/status/phase/title/summary/duration_ms/error_code` exact keys。
- Team `run.tool_*` 使用 first-class nullable `profile_id/task_id`，非 Team tool 固定 null。
- PostgreSQL event allowlist/validator、public SSE converter、trajectory decoder 原子更新。
- 禁止 reasoning_content、prompt、raw context、credentials 和未脱敏 Tool body。

## Acceptance Criteria

- [ ] Contracts 接受规范事件并拒绝未知 profile/status/key/private field。
- [ ] PostgreSQL 17 接受并重放 Agent status，projection state 不被 display event 擅自推进。
- [ ] Tool START/END identity 必须相等；profile/task 替换或缺失在 Team tool 上失败关闭。
- [ ] SSE cursor replay 与 direct public projection 字节等价。
