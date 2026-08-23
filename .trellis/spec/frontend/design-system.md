# Data Agent Frontend Design System

## Product Character

Data Agent 是高频分析与治理工作台，默认视觉密度 7/10。界面使用冷中性色和单一 Data Agent Blue
`#3f63e8` accent；green/amber/red 仅表达成功、警告和失败状态。避免营销 hero、蓝紫渐变、外发光、
嵌套卡片和无层级的大圆角。

## Tokens And Typography

- Token 实现在 `apps/web/src/app/design-system.css`，必须在 `globals.css` 后加载。
- UI font 使用 Geist 风格 sans fallback；ID、时间、数字、SQL、状态码使用 mono。
- tracking 随字号变化：页面标题约 `-0.035em`，正文接近 0，小号 uppercase label 约 `0.06-0.08em`；
  页面标题 24-34px，panel/card 内标题不超过 16px。
- control radius 10px、item 14px、panel 18px、sheet 24px；圆形只用于 icon button、avatar 或 status dot。
- 色彩 token 只在 `design-system.css` 定义；`globals.css` 只允许兼容 alias，不得维护第二套主题值。

## Layout

- `WorkspaceShell` desktop 为 sidebar/topbar/content/status，sidebar 展开 248px、折叠 64px；会话目录只在
  Q&A route 上下文加载和显示，其他页面只保留产品导航。
- `<1024px` 隐藏 desktop sidebar/status，使用顶部 workspace breadcrumb 和 5 项底部导航。
- 页面内容使用 `.page-frame` 或 `.workspace-container`，最大 1440px；图、QA、分析 split pane 可 full bleed。
- 页面 header 使用 `.page-heading/.page-eyebrow/.page-title/.page-description`。
- 数据表与导航列表以 border/divide 分组；card 只用于重复 item、modal 和真实 framed tool。

## White And Blue Appearance

- 产品固定使用 light color scheme：白色 reading surface、冷浅灰 canvas 与单一 Data Agent Blue
  `#3f63e8`。不提供 system/dark 外观入口，也不跟随系统深色模式。
- 页面、Sidebar、Topbar、表单和设置控制面不得使用黑色或深海军蓝作为大面积背景；层级通过白色透明度、
  浅蓝 selection、冷灰 border 和轻量蓝色阴影表达。
- 深色只用于有明确功能语义的局部内容，例如代码块、模态遮罩和用户消息；不能扩展成页面主题。
- 登录身份区使用浅蓝白材质，输入与正文使用白色 surface，品牌按钮和 icon 使用 Data Agent Blue。

## Operational Control Planes

- Data Sources 以单一连接目录为主，连接状态、目标、SSL 和更新时间按行扫描；Adapter Registry 是真实连接器
  catalog，可以保留重复 item grid。新增连接使用上下文 reading panel，不把每个连接做成悬浮 dashboard card。
- Members 由摘要、成员操作和审计目录组成，desktop 使用 table、mobile 使用等价 article；权限、撤销和
  SYSTEM_ROLE 状态不能被视觉简化隐藏。
- Settings 在 desktop 使用左侧 category rail 和右侧内容，mobile 使用局部横向滚动的 segmented tab；所有
  tab 保持 `role=tab/tablist/tabpanel` 与 `aria-selected`。

## Agent Conversation

- Agent answer 是文档流，不使用聊天气泡；用户输入使用紧凑深色 bubble。
- Assistant 正文统一经过 `SafeAssistantMarkdown`：模型 H1-H4 映射为页面 H2-H5，正文约 65ch；
  GFM 表格和代码只在自身容器局部横向滚动，不能扩张页面或遮挡 Composer。
- Markdown 以不可信输入处理：必须同时启用 `skipHtml`、显式 sanitize allowlist 与 URL transform；禁止
  `rehype-raw`、`dangerouslySetInnerHTML`、远程/本地图片、`javascript:` 和 `data:`。
- Artifact Markdown link 只有在当前正文 block 之前已经出现同 Run 的 exact
  `artifact_id/revision/content_hash` reference 时才能打开 Inspector；否则渲染为不可点击文本。
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

## Q&A Glass Material Contract

Q&A chrome 使用 `design-system.css` 的语义材质，而不是在组件内散落 blur：

```css
:root {
  --glass-fill: rgb(248 250 255 / 74%);
  --glass-fill-strong: rgb(252 253 255 / 90%);
  --glass-border-inner: rgb(255 255 255 / 88%);
  --glass-shadow-tint: rgb(42 66 138 / 16%);
  --glass-blur: 24px;
  --glass-saturate: 138%;
}

.glass-surface {
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
}
```

- `.glass-surface/.glass-surface-strong` 只用于 Sidebar、Topbar、Composer、Inspector 和移动导航；
  `.glass-overlay` 配对 drawer/dialog backdrop；正文、Table、VChart、code 使用 `.reading-surface`，不继承 blur。
- Composer 必须保留在 `qa-page-frame` 的 row 3，Inspector 继续由 `computeInspectorColumns` 和 container
  `ResizeObserver` 让步。禁止用 fixed Composer 或视觉层重新计算 geometry。
- ContextMeter 是 ModelSelector 与发送按钮附近的圆形图标控件，不新建高视觉重量 Card；popover 使用
  `surface-floating-strong`、Data Agent Blue 进度和冷灰文字。窄屏保持在 Composer 局部流内，不能越过 viewport，
  usage/capacity 缺失时不渲染空占位。
- `@supports not (backdrop-filter...)`、`prefers-reduced-transparency` 和 print 必须切换为 opaque surface；
  `prefers-reduced-motion` 必须停止 running pulse 与 skeleton shimmer。
- running/shimmer 仅动画 pseudo-element 的 `transform/opacity`；不能用 React state 驱动逐帧效果。

Good：组件只写 `className="glass-surface-strong"`，材质数值由 token 统一控制。

Base：不支持透明度时仍呈现带边界的浅色实体 panel，交互和 DOM 顺序不变。

Bad：在每个 Think/Tool/Artifact 行写 `backdrop-blur-xl bg-white/60 shadow-*`，造成卡片堆、数值漂移和 fallback 缺失。

必需测试：

- CSS contract 锁定六个 token、四个 surface class 和四类 fallback；
- 1440/1024/768/767/390 断言 `scrollWidth === clientWidth` 与 Composer/Inspector 无交叠；
- 1280/1000/959 保留 Inspector concession；
- computed style 证明 chrome 有 token blur，reading surface 为 `backdrop-filter: none`，reduced-motion 的动画名为 `none`。

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
