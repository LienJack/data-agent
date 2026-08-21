# Team Agent 公开状态事件合同

## Goal

建立可持久、可重放、可脱敏且与 surface 无关的 Team Agent 状态、Tool identity 与 Artifact locator 公共事件合同，
为 Worker、当前 Web Inline/Inspector 及未来 Desktop/TUI adapter 提供唯一状态语言。

## Requirements

- 新增 strict `run.agent_status` runtime/public event，profile 仅允许三个 specialist。
- 状态闭集为 `PENDING/RUNNING/COMPLETED/FAILED/INTERRUPTED/SKIPPED/BLOCKED`。
- payload 包含 `profile_id/task_id/status/phase/title/summary/duration_ms/error_code` exact keys。
- Team `run.tool_*` 使用 first-class nullable `profile_id/task_id`，非 Team tool 固定 null。
- Tool terminal event 使用 first-class `artifact_refs: ArtifactReference[]` 公布可预览产物；START 固定为空数组，禁止把本地路径或 Tool output 文本伪装成文件 locator。
- PostgreSQL event allowlist/validator、public SSE converter、trajectory decoder 原子更新。
- 新写入使用 `run-runtime-event@2.0.0` / `public-run-event@2.0.0`；读取路径保留 v1 decoder 并规范化为 v2（Tool identity `null`、`artifact_refs=[]`），不得静默改写历史行。
- 禁止 reasoning_content、prompt、raw context、credentials 和未脱敏 Tool body。
- Subagent Inspector 不新增第二条私有事件流；它以 `run_id/profile_id/task_id` 过滤同一条 Public Run Event 日志，Artifact Inspector 只按完整 `ArtifactReference` 调用现有 Workspace Preview 边界。
- 合同 core 不依赖 React、DOM、`EventSource`、Wails 或 TUI；Web REST/SSE 只是当前 transport adapter。
  不同 surface 可使用不同 envelope/view model，但共享 Run identity、event semantics、cursor、terminal closure 和公开错误码。

## Acceptance Criteria

- [x] Contracts 接受规范事件并拒绝未知 profile/status/key/private field。
- [x] PostgreSQL 17 接受并重放 Agent status，projection state 不被 display event 擅自推进。
- [x] Tool START/END identity 必须相等；profile/task 替换或缺失在 Team tool 上失败关闭。
- [x] Artifact refs 必须 exact scope/run/type/revision/hash，未知字段、跨 Workspace/Run 引用、裸路径和 hash 不一致均失败关闭。
- [x] SSE cursor replay 与 direct public projection 字节等价。
- [x] v1 历史 Tool event 可规范化回放，v2 新事件严格拒绝缺失 identity/ref keys；版本混合 Run 的 sequence 不变。
- [x] 同一组 replayed events 可确定性构建 Inline stream、Subagent Inspector feed 与 trajectory，三处 sequence/identity 一致。
- [x] Web SSE adapter 与无 DOM headless adapter 的 conformance fixture 保持 public event identity、cursor、terminal
      closure、Inspector target 和错误码一致；合同测试不要求交付 Desktop/TUI。
