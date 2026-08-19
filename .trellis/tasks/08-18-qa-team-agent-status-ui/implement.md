# Implementation Plan

- [ ] 写 assembler tests：交错 answer/reasoning/tool/agent、重复、terminal closure、刷新 replay、stale identity。
- [ ] 实现 `ConversationActivityBlock` projection、相邻 text coalescing 与 Tool/Subagent grouping。
- [ ] 实现 inline stream/disclosure 组件、中英文文案、a11y 和 reduced motion。
- [ ] 接入 `ChatMessage`，隐藏内部 role models，保持现有 ProcessDisclosure/answer 顺序。
- [ ] 添加 component tests 与 dev preview fixtures。
- [ ] 启动 Web/Worker 做真实 SSE 和 trajectory deep-link 验证。
- [ ] 通过 Playwright 1440x1000、390x844 截图和 overflow 检查，运行 Web tests/typecheck/Biome 并提交。
