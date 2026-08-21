# Team Agent Status Contract Design

## Boundaries

Contracts 定义唯一 DTO；PostgreSQL 验证 authoritative runtime event；Web 的 Inline stream、Subagent Inspector 和 trajectory 只消费同一 public projection。Artifact Preview 继续通过已有 Workspace Artifact API 读取，不把文件内容塞进 SSE。

DeepSeek Harness 的 SessionEvent surface、known-event refusal、append-only sequence、assembler identity 和
persistence contract 是本子任务的主要代码/测试参考；允许在 MIT 条款下移植 validator、normalizer、property-test
与 replay helper 的结构。Data Agent 仍定义自己的 v2 DTO、PostgreSQL validator 和 Workspace scope，不能直接暴露 Harness 私有事件。

## Data Model

- `run.agent_status` 是 display-only event，不改变 Run Projection status。
- Agent event key 使用 `team.agent.{profile_id}.{task_id|pending}.{status}`；sequence 仍由 Event Store 分配。
- 每次 Agent task durable transition 成功后追加事件；事件不能代替 Team Store truth。
- terminal Run 到达时，assembler 可闭合未完成状态，但数据库不会补造 Agent COMPLETED。
- Team Tool lifecycle key 仍以 `call_id` 合并，START/terminal 的 `profile_id/task_id` 必须相等；terminal 可追加已提交的 `artifact_refs`，START 固定 `[]`。
- `artifact_refs` 使用完整 `ArtifactReference`，必须属于事件的 Workspace/Run；它是 Inspector locator，不是 Artifact body，也不是任意 filesystem path。

## Inspector Addressing

```ts
type InspectorTarget =
  | {
      kind: "subagent";
      run_id: string;
      profile_id: AgentSpecialistProfileId;
      task_id: string;
      anchor_sequence: number;
    }
  | {
      kind: "artifact";
      run_id: string;
      reference: ArtifactReference;
      anchor_sequence: number;
    };
```

- `InspectorTarget` 是客户端选择合同，不另行持久化为 Run event。
- Subagent feed 由同一 Public Run Event 数组按 exact identity 过滤并按 sequence 投影；不暴露原始 SSE frame。
- Artifact body 通过 `GET /api/workspaces/:workspaceId/artifacts/:artifactId?reference=...` 获取严格 `ArtifactPreviewResult`，响应 `no-store` 并重新做 Workspace `READ`、scope、revision 与 hash 校验。

## Migration

新增前向 migration 扩展 event validator/allowlist/reducer；renderer 从 reviewed source segments 生成并校验 checksum。

## Compatibility

- 新写入使用 `run-runtime-event@2.0.0` / `public-run-event@2.0.0`；v1/v2 是显式版本联合，不能在 `@1.0.0` 下添加 required keys。
- 读取旧 Tool event 时由服务端兼容 decoder 规范化为 v2 public shape：identity 为 null、`artifact_refs=[]`；不 UPDATE 历史数据库行，也不改变 sequence。
- 旧 Run 无 Artifact ref 时不猜测路径，Inspector 显示“无可预览产物”。
