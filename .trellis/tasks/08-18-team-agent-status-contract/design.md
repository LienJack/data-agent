# Team Agent Status Contract Design

## Boundaries

Contracts 定义唯一 DTO；PostgreSQL 验证 authoritative runtime event；Web 只消费 public projection。

## Data Model

- `run.agent_status` 是 display-only event，不改变 Run Projection status。
- Agent event key 使用 `team.agent.{profile_id}.{task_id|pending}.{status}`；sequence 仍由 Event Store 分配。
- 每次 Agent task durable transition 成功后追加事件；事件不能代替 Team Store truth。
- terminal Run 到达时，assembler 可闭合未完成状态，但数据库不会补造 Agent COMPLETED。

## Migration

新增前向 migration 扩展 event validator/allowlist/reducer；renderer 从 reviewed source segments 生成并校验 checksum。

## Compatibility

旧 event 不变；Tool identity 新字段对非 Team 事件为 null，避免多个 schema 分叉。
