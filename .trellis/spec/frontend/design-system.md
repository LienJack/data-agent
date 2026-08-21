# Data Agent Frontend Design System

## Product Character

Data Agent 是高频分析与治理工作台，默认视觉密度 7/10。界面使用冷中性色和单一墨绿 accent；
amber/red 仅表达状态。避免营销 hero、装饰渐变、嵌套卡片和大圆角。

## Tokens And Typography

- Token 实现在 `apps/web/src/app/design-system.css`，必须在 `globals.css` 后加载。
- UI font 使用 Geist 风格 sans fallback；ID、时间、数字、SQL、状态码使用 mono。
- letter-spacing 固定为 0；页面标题 24-34px，panel/card 内标题不超过 16px。
- command control radius 4-6px，业务 item/card 最多 8px；圆形只用于 icon button、avatar 或 status dot。

## Layout

- `WorkspaceShell` desktop 为 sidebar/topbar/content/status，sidebar 展开 248px、折叠 64px。
- `<1024px` 隐藏 desktop sidebar/status，使用顶部 workspace breadcrumb 和 5 项底部导航。
- 页面内容使用 `.page-frame` 或 `.workspace-container`，最大 1440px；图、QA、分析 split pane 可 full bleed。
- 页面 header 使用 `.page-heading/.page-eyebrow/.page-title/.page-description`。
- 数据表与导航列表以 border/divide 分组；card 只用于重复 item、modal 和真实 framed tool。

## Agent Conversation

- Agent answer 是文档流，不使用聊天气泡；用户输入使用紧凑深色 bubble。
- `ProcessDisclosure` 按 reasoning/tool/progress 显示 icon、标题、公共摘要、状态、耗时和 caret。
- disclosure 默认 `aria-expanded=false`；展开只显示允许的 input/output/summary 与 trace locator。
- Semantic Authoring 的 `semantic-turn-*` 和 tool 使用 `<details>`；Team Trace 各组也使用 `<details>`。
- 禁止 private chain-of-thought、`reasoning_content`、system prompt、raw context、SecretRef、Provider 原始载荷。

## Responsive And Accessibility

- 全高使用 `100dvh`，禁止新增 `h-screen`。
- 390px 必须 `document.scrollWidth === document.clientWidth`；toolbar 自动换行或水平局部滚动。
- icon button 必须有 `aria-label/title`，未知 icon 使用 tooltip；focus-visible 是 2px accent outline。
- motion 只改 transform/opacity，并尊重 `prefers-reduced-motion`。

## Verification

- Web unit/typecheck/build。
- 1440x1000：Workspace home、QA、Tests、Data Sources、Semantic Preview、Settings。
- 390x844：Login、Workspace home、Analysis、QA、Tests、Members、Semantic Preview。
- Agent preview：collapsed screenshot、expanded tool screenshot、Enter keyboard toggle。

## Knowledge 与 Semantic Authoring

- Knowledge Base 是 Workspace 一级公司资产页面；`/settings` 只提供说明和跳转，禁止维护第二套创建、重建
  或检索调试表单。
- Markdown Document 详情以版本、Block locator、Annotation、Usage 和 Evidence Selection 为主轴；用户选择
  exact Block 后再进入 Semantic Agent，不自动扩展证据或创建 Candidate。
- Semantic Studio 保持 Agent 为主要创作入口，同时提供 Node、Edge instance、Formula AST 与 Edge
  attributes 的判别式表单。禁止任意 JSON Patch；system-managed physical facts 必须显示锁定原因。
- 新关系类型使用独立 `ADD_EDGE_TYPE` proposal 表单，不能在普通 Edge instance editor 临时注册；proposal
  与实例修改都先进入未保存 ChangeSet。
- 未保存 typed operations 必须按顺序本地投影：新增 Node/Edge Type 立即可被后续 Edge 使用，重复编辑同一
  Node/Edge 必须基于前一次本地版本继续递增；服务端保存时仍重放同一 operation 序列并最终裁决。
- 不使用 autosave 创建治理 Revision。界面必须持续显示 dirty/saved 状态，用户显式点击保存才形成可恢复
  Candidate Revision；刷新按 exact Authoring Run 恢复 last saved Revision，创建者自审发布只对该 Revision
  启用。
