# Frontend Redesign Design

## Visual System

- Palette：冷白 canvas、白色 surface、深绿单一 accent、amber/red 仅用于状态。
- Typography：Geist 风格 sans；ID、时间、数值与 SQL 使用 mono；letter-spacing 不为负。
- Radius：工具控件 4-6px，业务容器最多 8px；不用胶囊按钮承载普通命令。
- Material：边线/分隔优先，只在 modal、浮层和真正独立 item 上使用 shadow。

## Layout

- `AppShell`：平台控制面顶部品牌条 + 内容 + 状态条。
- `WorkspaceShell`：desktop sidebar/topbar/content/status；mobile topbar/content/bottom navigation。
- 页面内容最大宽 1440px；分析/QA/图工作台允许 full bleed。
- 页面 header 使用 eyebrow/title/description/actions，数据区以 table/list/split pane 呈现。

## Agent Conversation

Agent 回复按 identity row -> process timeline -> answer -> timestamp。Process row 使用 icon、状态、标题、
摘要、耗时与 caret；展开后只展示公开 input/output/summary，并提供定位轨迹动作。

## Motion

只用 transform/opacity；导航、按钮和 disclosure 使用 160-240ms ease-out。尊重
`prefers-reduced-motion`，不在大列表中使用持续动画。
