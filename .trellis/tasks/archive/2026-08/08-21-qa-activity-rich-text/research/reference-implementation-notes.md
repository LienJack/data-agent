# Reference Implementation Notes

## DeepSeek Harness

- Checkout：`/Users/lienli/Documents/GitHub/deepseek-harness`
- Branch：`master`
- Commit：`47f943859bef60e4160492346772ded9b24f765a`
- Workspace：除 `.ua/` generated graph 外 clean。
- Graph：`.ua/knowledge-graph.json`，`analyzedAt=2026-08-14T10:18:20.336566+00:00`，graph commit 与 HEAD 一致。
- License：MIT，`Copyright (c) 2026 DeepSeek`。

### Source proof

- `AssistantMarkdown.tsx`：按 Assistant block 原序渲染 Markdown 与 Reasoning；tool head 交给 keyed tool row，streaming partial 与 settled 共用组件。
- `ReasoningRow.tsx`：Think 默认折叠，running summary tail-follow，settled 回到 first line；状态有非颜色可访问文本。
- `ToolRow.tsx` + `tool-call-model.ts`：model 先派生单一 row projection，组件只做单行 disclosure、IN/OUT、error 和 Inspect；expand 是本地 view state。
- `DetailsPanel.tsx`：selection 来自共享 store，material 从同一 conversation snapshot 派生，不保存第二份 tool truth。
- `conversation-assembler.ts`：keyed event assembler 与 snapshot structural sharing 是 replay/stream 稳定性的核心。
- `markdown-cjk-strong.e2e.ts` / `markdown-inline-code-links.e2e.ts`：CJK 邻接强调、危险 URL、键盘链接和 aria snapshot 是直接可迁移的测试思想。

### Data Agent decision

- **采用**：keyed projection、block composition、低干扰 disclosure、shared snapshot Inspector、CJK/URL behavior tests。
- **改造**：只显示 public summaries；PostgreSQL sequence 决定 order/terminal；ArtifactReference 替换 local path；所有 remote Markdown image blocked。
- **拒绝**：private reasoning body、host openFile、Cordis/session authority、品牌 token、任意远程图片和无限子会话 lineage。

## Reasonix

- Checkout：`/Users/lienli/Documents/GitHub/agent-ref/DeepSeek-Reasonix`
- Branch：`main-v2`
- Commit：`668cdee703680530901c67ff3908a95b720ad0d2`
- Workspace：仅 `.ua/` generated graph untracked。
- License：MIT。

只采用共享 controller/event core 后连接不同 surface adapter 的分层思想；本 child 只交付 Web，不复制 Reasonix UI/TUI/Desktop 代码。
