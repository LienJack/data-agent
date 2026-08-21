# Q&A Activity Stream and Safe Rich Text — Technical Design

## 1. Reference Boundary

- DeepSeek Harness checkout：`/Users/lienli/Documents/GitHub/deepseek-harness`
- Fixed commit：`47f943859bef60e4160492346772ded9b24f765a`
- Graph：`.ua/knowledge-graph.json`，graph commit 与 HEAD 一致；排除 `.ua/` 后无源码漂移。
- License：MIT，`Copyright (c) 2026 DeepSeek`。
- 采用：keyed assembler、ReasoningRow/ToolRow 的低干扰 disclosure、AssistantMarkdown 的 block composition、DetailsPanel 的 shared snapshot material。
- 改造：SessionEvent/Cordis/host `openFile` 替换为 strict PublicRunEvent、PostgreSQL sequence、QAInspectorTarget 和 authenticated Artifact Preview。
- 拒绝：私有 reasoning text、任意本地文件打开、远程 Markdown image、Harness 品牌 token 和通用无限层 subagent lineage。

Reasonix 固定 commit `668cdee703680530901c67ff3908a95b720ad0d2` 仅支撑“surface-neutral projection core + Web adapter”边界，
不复制其 TUI/Desktop/Wails 实现。

## 2. Data Flow

```text
PostgreSQL run_events / deferred receipt
  -> strict Contracts decoder/hash verification
  -> qa-event-assembler (stable sequence identities)
  -> ConversationActivityBlock[] + authorized ArtifactReference set
  -> Web leaf components
       -> ProcessDisclosure / AgentDisclosure
       -> SafeAssistantMarkdown
       -> QA Inspector selection
```

Transport、connection 和 view state 不写回 authority。Markdown 只格式化 answer text；执行摘要始终按纯文本渲染。

## 3. Activity Projection

保留当前 `ProcessRow`、`TeamAgentView` 与 `ConversationActivityBlock` 判别联合。补充纯函数：

```typescript
function isRunTerminal(events: readonly PublicRunEvent[], runId: string): boolean;
function authorizedArtifactsBefore(
  blocks: readonly ConversationActivityBlock[],
  sequence: number,
): readonly ArtifactReference[];
```

- text block ID 固定为该连续 answer 区间第一条 sequence；后续 delta 只 append `content`。
- Tool/Reasoning/Agent 生命周期保持第一条 sequence，最新状态只覆盖同 identity 的 material。
- Agent owned Tool/Artifact 保持一层；不产生独立 Agent placeholder。
- disclosure expand state 是组件本地 view state；Inspector selection 继续由 QA store/URL 持有。
- 运行中的视觉效果只用 opacity/transform，尊重 `prefers-reduced-motion`；不因 SSE 断开改变 authority status。

## 4. Safe Markdown Renderer

新增最小 client leaf `SafeAssistantMarkdown`，使用项目未安装的依赖前先显式安装并锁定：

- `react-markdown`
- `remark-gfm`
- `rehype-sanitize`

不接入 `rehype-raw`。`ReactMarkdown` 配置 `skipHtml`、GFM plugin、显式 sanitize schema 和自定义 components。

### Element mapping

| Model element | DOM | Presentation |
| --- | --- | --- |
| H1/H2/H3/H4 | H2/H3/H4/H5 | 24/20/17/15px，确定性上下间距 |
| paragraph | p | max 65ch，16px/28px |
| list/task list | ol/ul/li/input disabled | 紧凑文档流，不包 Card |
| blockquote | blockquote | 左边线 + muted text |
| inline code | code | mono + neutral inset |
| fenced code | pre/code | code label + local horizontal scroll |
| table | table wrapper | 只作为 Markdown 文档结构，局部滚动，无“受治理”徽章 |
| image | blocked placeholder | 不生成 `img` 网络请求 |

### URL and Artifact policy

- 允许：`https:`, `http:`, `mailto:`, `#fragment`。
- 拒绝：`javascript:`, `data:`, `file:`, `blob:`, protocol-relative、相对/绝对本地路径及未知 scheme。
- 受控 Artifact href：`artifact://<artifact_id>/<revision>/<content_hash>`。只有与当前正文 block 之前出现的完整
  `ArtifactReference` 的 `artifact_id/revision/content_hash/run_id` 精确匹配时，渲染为打开 Inspector 的 button；否则显示 inert text。
- Markdown image 一律渲染为“图片已阻止”文本；不复制 Harness 的远程 image 行为。

Renderer 不使用 `dangerouslySetInnerHTML`。代码语言仅作为纯文本 label/class，不加载任意 grammar 或执行内容。

## 5. Deferred Presentation

`api-client.request` 在非 2xx 时先尝试：

1. `contractErrorSchema`；
2. `agentDispatchAdmissionResultSchema` + `verifyAgentDispatchAdmissionResult`。

校验成功且 `kind=DEFERRED` 时抛出 typed `DeferredRunAdmissionError`。QA store 将其投影为一个 public blocked message，
metadata 只保存 receipt 本身，不保存 question classifier 私有信息。展示字段限制为 `question_class`、`reason_code`、
`required_capabilities`、`policy_version`、`receipt_hash`。

DEFERRED 不是失败 Run：不创建 agent message with run stream、不请求 SSE、不制造 terminal。普通未知 409 仍走现有 error path。

## 6. Accessibility And Layout

- disclosure 使用原生 button，`aria-expanded/controls`，整行 click + Enter/Space。
- Inspector action 与 disclosure 为 sibling；关闭后使用现有 trigger ID 恢复 focus。
- RUNNING 不逐 delta live announce；terminal/failed/blocked 使用简短 `aria-live=polite`。
- code/table wrapper 局部 overflow；正文 `overflow-wrap:anywhere`；390px document 不横向溢出。
- 本 child 不重做全局 glass token；保留后续 Apple Glass child 的 surface ownership。

## 7. Validation And Rollback

### Tests

- assembler：乱序、重复 replay、answer streaming、exact Agent subset、terminal closure。
- renderer：heading/CJK/GFM/code/link/artifact、HTML/XSS/image/local path、streaming incomplete fence。
- disclosure：collapsed、keyboard、status/error/duration、sibling Inspector action、one-level children。
- API/store：verified DEFERRED、forged receipt、ordinary 409、zero Run/SSE behavior。
- browser：1440x1000、390x844、no overflow、focus return、真实 conversation replay。

### Rollback

- Markdown renderer 可退回纯文本，但不得退回 raw HTML。
- DEFERRED presentation 可退回 structured error row，但不得把 receipt 解释为失败 Run。
- Activity projection 保持现有 PublicRunEvent contracts，不需要数据库回滚。
