# Implementation Plan

- [ ] 写 assembler tests：交错 answer/reasoning/tool/agent/artifact refs、重复、terminal closure、刷新 replay、stale identity。
- [ ] 建立 Harness source-reuse ledger；固定 commit/MIT，映射 upstream -> Data Agent target -> copied/adapted/tests。
- [ ] 从 Harness keyed assembler/snapshot 移植 `ConversationActivityBlock` projection、相邻 text coalescing 与 Tool/Subagent grouping。
- [ ] 保持 assembler/snapshot 无 React/DOM/`EventSource` 依赖，并用 headless fixture 与 Web adapter 跑同一 replay conformance。
- [ ] 从 Harness ReasoningRow/ToolRow/Disclosure 移植 inline 组件结构，再替换 Data Agent 文案、token、icon、a11y 和 authority DTO。
- [ ] 在 QA store 增加严格 `QAInspectorTarget`、URL 恢复、跨 Conversation/Run 清理和焦点返回。
- [ ] 从 Harness AppFrame/columns/stores/DetailsPanel 移植 desktop right rail、resize/concession/selection；适配 mobile content sheet。
- [ ] 从 Harness Session/Manager/Subagent catalog 移植 baseline + live merge/diagnostic UI，替换为 Run SSE 与一层 Team depth。
- [ ] 复用 ProducedFiles 的 chip/测宽/交互代码，删除 host `openFile` 并接入 ArtifactWorkspace preview adapter。
- [ ] 接入 `ChatMessage`，隐藏内部 role models，保持现有 answer sequence；Disclosure 与 Inspector entity action 使用兄弟控件。
- [ ] 添加 component tests 与 dev preview fixtures，覆盖 loading/reconnecting/unsupported/denied/hash mismatch/stale target。
- [ ] 启动 Web/Worker 做真实 SSE、Inspector 增量、Artifact preview 和 trajectory deep-link 验证。
- [ ] 按 Codex desktop parity matrix 完成 Playwright 1440x1000、390x844、右栏 resize/restore、焦点、Composer 和 overflow proof。
- [ ] 校验所有实质性 Harness 复制均有 MIT/modified-source 记录，运行 Web tests/typecheck/Biome 并提交。
- [ ] 不实现 Reasonix 风格 TUI/Desktop/ACP；若未来新增 surface，必须另建任务并只接入共享 protocol core。
