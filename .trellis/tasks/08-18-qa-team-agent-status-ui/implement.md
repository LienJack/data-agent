# Implementation Plan

- [ ] 写 assembler tests：交错 answer/reasoning/tool/agent/artifact refs、重复、terminal closure、刷新 replay、stale identity。
- [ ] 实现 `ConversationActivityBlock` projection、相邻 text coalescing 与 Tool/Subagent grouping。
- [ ] 实现 inline stream/disclosure 组件、中英文文案、a11y 和 reduced motion。
- [ ] 在 QA store 增加严格 `QAInspectorTarget`、URL 恢复、跨 Conversation/Run 清理和焦点返回。
- [ ] 实现 desktop right rail/mobile content sheet、Subagent baseline + live feed 和 ArtifactWorkspace preview adapter。
- [ ] 接入 `ChatMessage`，隐藏内部 role models，保持现有 answer sequence；Disclosure 与 Inspector entity action 使用兄弟控件。
- [ ] 添加 component tests 与 dev preview fixtures，覆盖 loading/reconnecting/unsupported/denied/hash mismatch/stale target。
- [ ] 启动 Web/Worker 做真实 SSE、Inspector 增量、Artifact preview 和 trajectory deep-link 验证。
- [ ] 通过 Playwright 1440x1000、390x844 截图、焦点、Composer 可操作性和 overflow 检查，运行 Web tests/typecheck/Biome 并提交。
