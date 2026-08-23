# U8 会话恢复 Run 控制 Checkpoint 分支与协作中断

## Goal

让刷新、Cancel/Resume、Worker 重启、澄清中断与 Checkpoint 分支都由 PostgreSQL Event/Projection/Receipt
恢复；任何恢复路径都不能复制历史或重复接受 Tool、Artifact、SQL、Provider/MCP Effect。

## Background

- U4 已实现 durable Run Event、Projection、Lease/Fence、Checkpoint、Cancel/Resume 与 Effect Receipt。
- U19 已实现 PostgreSQL Team Task/Context Epoch/TaskCapability；U8 不创建第二套 Team 或恢复 Authority。
- 当前 `ClarificationDialog` 只写 Zustand，本地刷新会丢失澄清，且没有 interruption version/fence/actor 绑定。
- 当前没有引用式 Session Branch Authority，也没有 branch 对 parent checkpoint/effective config revalidation 的闭包。

## Requirements

- 扩展公开 Run 状态以携带可恢复的 interruption 摘要，但不泄漏 Prompt、私有 Context 或原始工具输出。
- `RunInterruption` 固定 scope/run/interruption/type/question/options/worker fence/expected version/state；Reply
  必须绑定 actor、exact open version、reply hash 和 idempotency key。
- 回复只能把 `OPEN` 原子推进为 `ANSWERED`；重复同载荷 replay，旧 version/fence、跨 Workspace、终态 Run、
  不同载荷复用幂等键全部失败关闭。
- `SessionBranch` 只保存 parent conversation/run/checkpoint boundary、effective config revalidation receipt、child
  conversation identity 与 branch hash；不复制父消息、Event、Artifact 或 Effect。
- 创建 Branch 时数据库重验父 Run 可见性、Checkpoint hash、Projection active snapshot、Effective Config
  scope/hash 和 child identity 唯一性；不可见/过期/stale 引用返回 not-found-or-denied 或稳定 stale reason。
- Cancel/Resume 保持 U4 状态机与 Fence；重复命令必须 replay，旧 Fence 不得控制新 Lease。
- Web 新增 workspace-scoped branches/interruption routes；服务端注入 scope、actor、operation identity，客户端
  不能自报 role/fence/current version。
- `ClarificationDialog` 消费持久 interruption DTO，提交期间禁用重复动作，成功后从 durable trajectory 刷新；
  关闭只关闭视图，不伪造取消或已回答状态。
- 本单元不调用真实 Provider/MCP、不运行 Falcon、不新增进程内会话权威。

## Acceptance Criteria

- [x] Contracts 对 Branch/Interruption/Reply canonical hash、scope、version/fence/actor splice 和未知字段失败关闭。
- [x] PostgreSQL 10666 使用 NOLOGIN owner、FORCE RLS、窄 RPC；Branch/Reply replay/CAS/stale/cross-workspace 矩阵全绿。
- [x] Branch 只引用父历史；父 Event/Message/Artifact/Effect 行数与 hash 在分支后不变。
- [x] OPEN interruption 刷新后仍可见；exact Reply 后 Run 可 Resume，重复 Reply 不生成第二 Event/Outbox/Effect。
- [x] Cancel/Resume/Reply/Branch 的旧 Fence、旧 version、不可见 checkpoint 与 terminal Run 全部拒绝。
- [x] Web Route 和澄清 UI 覆盖 loading/open/submitting/replayed/stale/permission/error，桌面与移动端无重叠。
- [x] Contracts/Platform/Web scoped/full relevant tests、typecheck/build、Biome、renderer/static 与 fresh PG17 assertions 全绿。

## Out Of Scope

- 不实现 U9 Trace/SQL History 聚合、U20 三 Profile 编排或 U17 全产品旅程。
- 不复制/编辑父对话历史，不支持递归/多父合并分支。
- 不改变 U3 Provider 与 U14 Tool Effect 的恢复语义；只引用其已提交 Authority。
- 不自动重试 `OUTCOME_UNKNOWN` 外部 Effect。

## Notes

- 对应 G6、M06–M09；依赖 U2、U19，并复用 U4/U3/U14 已存在的恢复事实。
- 父计划与自动续行指令已批准本单元范围；Blocking Questions 为空。
- 10666 checksum：`sha256:e2fc0422baca33341f76072af3621aaab0c702c4b01a2044e17abf476584aef2`。
- 浏览器验收覆盖 1440px 与 390px；选项选择前主动作禁用，选择后启用且无横向溢出。
- Contracts 全量 65/65 files、778/778；Web 全量 79 passed + 1 skipped、296 passed + 1 skipped。
- Platform 全量仅保留共享 U11 foundational-source fixture 失败；U8 focused/surface 5/5 通过。
