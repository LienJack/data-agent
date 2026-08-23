# Q&A Activity Stream and Safe Rich Text

## Goal

在已经交付的 Public Run Event、按需 Agent 调度和 Inspector 基础上，把回答呈现收敛为接近 DeepSeek Harness / Reasonix
的单列文档流：实际发生的 Think、Tool、Subagent、Artifact 与回答正文按 sequence 穿插，回答正文使用安全、可访问、流式稳定的
富文本渲染。不得为视觉完整性制造 Agent、Tool、Artifact 或私有思考。

## Requirements

### A. Activity Stream

- **R1**：`assembleConversationActivity` 继续是无 React/DOM/`EventSource` 的唯一活动投影；durable replay、SSE 增量、刷新和
  两次重连必须产生相同 block identity 与 sequence order。
- **R2**：连续 `answer_delta` 只合并当前正文块；Reasoning 按 `block_id`、Tool 按 `call_id`、Subagent 按 exact
  `profile_id/task_id` 就地更新。状态变化不得新增重复行或重排已经阅读的正文。
- **R3**：Think、Tool/Write/Bash、Subagent 使用低干扰单行，默认折叠；支持
  `PENDING/RUNNING/COMPLETED/FAILED/INTERRUPTED/SKIPPED/BLOCKED`、耗时和公开错误码。执行行不得使用高重量 Card 堆叠。
- **R4**：只有实际公开 Agent event 才产生 Subagent 行。展开最多包含一层 owned Tool/Artifact；没有实际 Agent 时 DOM、可访问树和
  Inspector target 都不得出现 Agent 占位或“0 个 Agent”。
- **R5**：Inline disclosure 与 Subagent/Artifact Inspector action 保持兄弟控件，不能 nested button。`task_id=null` 不能打开
  Inspector；Artifact 只通过完整且已授权的 `ArtifactReference` 打开，不能从正文、Tool output 或本地路径猜测。
- **R6**：SSE connection state 与 Run/Agent authority 分离。断线只显示 reconnecting；Run terminal 才能关闭仍在运行的公共行。
  开始、阻断、失败、完成使用节流后的 `aria-live=polite`，运行中 token/delta 不逐字播报。
- **R7**：自适应 admission 的 `DEFERRED` 409 不再显示通用 HTTP 错误；UI 显示一个无虚构 Subagent 的公开 BLOCKED 结果，包含
  public reason code 与 required capabilities。该结果来自校验后的 deferred receipt，不把 409 当失败 Run。

### B. Safe Rich Text

- **R8**：所有 Assistant 正文统一使用安全 Markdown renderer，支持语义化 H1–H4、段落、粗体、斜体、删除线、有序/无序/任务列表、
  引用、分隔线、链接、行内代码、带语言标签的代码块和基础 GFM 表格。页面只保留一个主 H1；模型 H1–H4 映射到页面基准以下。
- **R9**：标题必须有确定性字号、字重和段落间距差异；正文约 65ch，CJK 邻接强调、长链接、代码和窄屏换行正确。富文本属于文档流，
  不放进聊天气泡或每段独立 Card。
- **R10**：输入按不可信内容处理：启用 `skipHtml` 与显式 sanitize allowlist，不使用 `rehype-raw` 或
  `dangerouslySetInnerHTML`；拒绝 raw HTML、事件属性、`javascript:`、`data:`、任意本地路径和 Markdown 远程图片。
- **R11**：普通链接只允许 `http/https/mailto` 与安全页内 anchor；外链使用 `target=_blank` 和
  `rel="noopener noreferrer"`。Artifact Markdown link 只有在其完整 identity 与当前 block 之前出现的已授权 reference 精确匹配时
  才能打开 Inspector，否则作为不可点击文本显示。
- **R12**：流式增量只更新当前 text block，React key 使用稳定 Run/block identity，不使用 Markdown AST position 作为持久 identity。
  未闭合标题、强调、链接或代码 fence 不得重建 Tool/Subagent siblings、重复正文或产生页面级布局跳动；refresh replay 与完成态等价。
- **R13**：legacy Assistant 文本、Report 和 Hypothesis 也经过同一 renderer；用户输入继续按纯文本呈现，不把用户 Markdown 解释成 HTML。

### C. Accessibility, Responsive And Provenance

- **R14**：折叠控件支持 click、Enter、Space、`aria-expanded/aria-controls`、focus-visible 与关闭 Inspector 后 focus return；状态不能只靠颜色。
- **R15**：1440x1000、1024x768、390x844 下正文、代码、表格和 disclosure 只能局部横向滚动，不能覆盖 Composer 或产生 document overflow。
- **R16**：DeepSeek Harness 固定 commit `47f943859bef60e4160492346772ded9b24f765a` 是主要源码基线；新增实质性适配更新
  reuse ledger 和现有 MIT notice。Reasonix 只作为共享事件 core/多 surface adapter 的架构参考，不复制 UI 代码。

## Acceptance Criteria

- [x] **AC1 / Replay**：包含 Think、两段正文、实际 Text2SQL、owned Tool/Artifact 和 terminal 的 fixture 在乱序输入、durable replay、
  两次重复 SSE merge 与刷新后得到相同 ID/order，生命周期只更新原行。
- [x] **AC2 / Adaptive visibility**：DIRECT fixture 没有 Subagent；Text2SQL-only 只有一个 Subagent；Text2SQL+Report 只有两个；未选 Agent
  在 DOM、可访问树和 Inspector target 均不存在。
- [x] **AC3 / Disclosure**：Think、Tool、Subagent 默认折叠，Enter/Space 可展开；状态、耗时、失败/阻断公开错误码可感知；Subagent 只嵌套一层。
- [x] **AC4 / Rich text**：同一回答渲染两级以上标题、段落、CJK 强调、列表、任务列表、引用、行内代码、代码块、链接和 GFM 表格；
  DOM heading hierarchy、字号/间距、复制文本和窄屏换行正确。
- [x] **AC5 / Safety**：raw HTML、script、事件属性、`javascript:`、`data:`、远程/本地图片和未授权 Artifact link 均不执行、不请求、不打开；
  授权 Artifact link 只打开 exact Inspector target。
- [x] **AC6 / Streaming**：逐 chunk 输入未闭合强调、链接和 fence 时，无重复 text block、无 Tool/Subagent remount identity、无整条消息闪烁；
  terminal replay DOM 语义与一次性完成渲染一致。
- [x] **AC7 / Deferred**：真实或等价 Web admission 409 经 receipt schema/hash 校验后显示 BLOCKED、reason code 与 capability；
  不创建假 Run/Agent，也不显示 `API 请求失败 (409)`。
- [x] **AC8 / Responsive and a11y**：1440x1000 与 390x844 browser proof 无页面横向溢出或 Composer 覆盖；键盘折叠、链接与 Inspector focus return 通过。
- [x] **AC9 / Regression**：Web unit/typecheck/build、activity/Inspector/reconnect focused tests 与 `pnpm test:contract` 通过；无 private reasoning/raw payload regression。
- [x] **AC10 / Provenance**：reuse ledger 记录新增 upstream/target/mode/difference/validation，MIT notice 覆盖实质性改造。

## Out Of Scope

- 受治理 TABLE/VChart 数据 block、目录/回收站、管理员审计、完整 Apple Glass token 重构和旧归因删除由后续 child 负责。
- 不新增 Desktop/TUI/ACP surface，不复制 Codex 私有协议、品牌资产或完整产品外观。
- 不显示 chain-of-thought、Provider reasoning、prompt、raw context、SecretRef 或 raw Tool payload。
- 不把任意 Markdown 表格当成受治理 SQL 结果；真实数据展示仍必须等待 committed Artifact child。
