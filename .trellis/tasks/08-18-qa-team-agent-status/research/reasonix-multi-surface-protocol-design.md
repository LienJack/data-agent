# Reasonix 多端运行时协议设计参考

## Reference Boundary

- 本地参考仓库：`/Users/lienli/Documents/GitHub/agent-ref/DeepSeek-Reasonix`
- 固定提交：`668cdee703680530901c67ff3908a95b720ad0d2`
- 许可证：MIT，`Copyright (c) 2026 Reasonix Contributors`
- 用途：只参考“同一运行时如何服务 TUI、Web、桌面与编辑器”的分层思想；本任务不计划复制 Reasonix 代码。
- 优先级：Data Agent 权威合同 > Codex 桌面功能语义 > DeepSeek Harness 主要代码基线 > Reasonix 多端分层思想 > Data Agent 视觉 token。

如果后续实现实际复制或实质性改写 Reasonix 源码，必须另建来源映射并保留其 MIT notice；当前设计引用本身不进入
DeepSeek Harness source-reuse ledger。

## Verified Architecture

Reasonix README 将产品描述为同一个本地引擎可从 terminal、desktop、browser 或 ACP editor 进入。
`REASONIX.md` 和源码进一步证明其核心不是“一种 wire protocol 统治所有客户端”，而是：

1. `internal/control.Controller` 是无前端、无传输依赖的 session driver，统一处理 Send、Cancel、Approve、
   Plan Mode、Compact、New Session 等命令，并向 `event.Sink` 发出类型化事件。
2. `internal/cli`、`internal/serve`、`internal/acp` 与 `desktop` 是不同 surface adapter；HTTP 使用 JSON/SSE，
   ACP 使用自己的协议，Wails Desktop 使用绑定方法与 `runtime.EventsEmit`，TUI 使用终端 channel。
3. `internal/serve.Broadcaster` 把同一类型化事件转换为 wire event 并 fan-out 给 SSE subscriber；历史/重连仍由
   session/controller 边界恢复，而不是让浏览器成为 authority。
4. `tools/repolint/layers.go` 强制只有 frontend/host 可以依赖 `internal/control`，底层包不能反向依赖 frontend；
   共同行为必须下沉到 Controller 以下，而不是在各端复制。
5. Desktop 的 React `useController` 是 surface-local projection/state machine；它不等于核心 Controller，也不应
   反向定义模型执行、权限或 session lifecycle。

因此，对 Reasonix 的准确归纳是“共享控制内核、命令语义、类型化事件和 session identity，多种 transport/surface
分别适配”，不是“所有端使用完全相同的网络帧格式”。

## Adaptation For Data Agent

Data Agent 当前仍只交付真实 Web + Worker 纵向切片，但合同必须具备 surface-neutral 形状：

```text
PostgreSQL authority / Team Runtime / Artifact Store
                      |
       versioned public run protocol
  (events + replay cursor + commands + inspector targets)
           /                |                \
   Web REST/SSE       future Desktop      future TUI
   adapter (now)       adapter (later)    adapter (later)
```

“Public Run Protocol”在本项目中表示稳定的领域语义，而不是绑定某种传输：

- identity：`workspace_id/conversation_id/run_id/sequence` 与 `profile_id/task_id/call_id`；
- event：严格 `PublicRunEvent@v2` 和 terminal/Agent/Tool/Artifact locator 语义；
- replay：同一 cursor、去重、terminal closure 和 baseline + live 合并规则；
- commands：发送、取消、审批等命令只能进入同一 Workspace/Run authority，surface 不拥有第二套状态机；
- inspection：`QAInspectorTarget` 与 `ArtifactPreviewResult` 是公共选择/读取合同，具体 pane、sheet 或 TUI view
  是 surface-local presentation。

本任务只实现 Web REST/SSE adapter，并增加 headless contract adapter/fixture 证明 projection 不依赖 React、DOM 或
浏览器 `EventSource`。未来 Desktop/TUI 可以消费同一 DTO/identity/replay 语义，但不在本任务创建应用壳、ACP server、
终端 UI 或通用跨端 SDK。

## Invariants To Carry Into The Plan

- Model/provider/profile binding 由 Effective Config、Run 与 Worker 决定，不因 Web/Desktop/TUI surface 改变。
- Runtime、event validator、Artifact authority 不得 import Web/Desktop/TUI package。
- Surface adapter 只能发命令、读取 snapshot/replay 和渲染 public events；不能推进 Agent/Run authority。
- SSE/ACP/Wails/TUI 连接状态都不是 Agent 状态；重连只恢复 cursor，不伪造 completed/failed。
- 所有 surface 共享稳定 identity 和公开错误码，但允许使用不同 wire envelope 与 view model。
- DeepSeek Harness 继续提供 assembler、Inspector、Subagent baseline/live 与 UI 的主要实现；Reasonix 只补足
  “一个运行时、多种 surface adapter”这一架构约束。

## Evidence Paths

- `README.md:44,77`
- `REASONIX.md:11-18`
- `internal/control/controller.go:1-10`
- `internal/control/port.go`
- `internal/event/event.go`
- `internal/serve/serve.go:1-7`
- `internal/serve/broadcaster.go`
- `internal/acp/protocol.go`
- `internal/acp/dispatch.go`
- `desktop/app.go:118-128`
- `desktop/frontend/src/lib/useController.ts`
- `tools/repolint/layers.go`
