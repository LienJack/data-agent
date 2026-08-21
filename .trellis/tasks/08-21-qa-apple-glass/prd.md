# Apple Glass Q&A Presentation

> 状态：已实施并完成真实浏览器验收

## Goal

在不改变 Q&A 事件、Run、Conversation、Artifact 与权限合同的前提下，把已经稳定的对话几何升级为浅色 Apple 式玻璃材质系统。玻璃只表达空间层级：Sidebar、Topbar、Composer、Inspector、移动导航与 Overlay 使用磨砂/折射表面；Assistant 富文本、表格和 VChart 保持近实色阅读面。

## Product Principles

1. 使用用户指定的 `design-taste-frontend` 参数：`DESIGN_VARIANCE=8`、`MOTION_INTENSITY=6`、`VISUAL_DENSITY=4`。
2. 只交付现有浅色主题；冷中性画布配一个低饱和深墨绿 accent。禁止紫蓝 AI 渐变、霓虹 glow、纯黑大底、Emoji 图标和全页面 Card 堆叠。
3. 参考 Apple 的材质语言，不复制 Apple/Codex 品牌资产或私有界面；DeepSeek Harness 继续只作为已固定提交的对话/Inspector 分层代码基线。
4. 视觉改造不改变数据加载、SSE、Inspector target、目录 authority、Composer 命令或 VChart projection。

## Requirements

### Material Tokens

- **R1**：在 `design-system.css` 单点定义 `--glass-fill`、`--glass-fill-strong`、`--glass-border-inner`、`--glass-shadow-tint`、`--glass-blur`、`--glass-saturate`，组件不得散落新的 blur/saturate 数值。
- **R2**：提供 `glass-surface`、`glass-surface-strong`、`glass-overlay` 和 `reading-surface` 语义类；主要玻璃面包含半透明 fill、20–32px blur、120–140% saturate、1px 折射边、inset highlight 和低饱和染色扩散阴影。
- **R3**：大悬浮容器半径 18–24px，小控件 10–14px；不把所有按钮改为胶囊，也不覆盖数据表/正文自身的矩形阅读结构。

### Q&A Layering

- **R4**：Workspace Sidebar、Topbar、Q&A view switcher、Composer、QA Inspector、移动底栏和移动目录/确认 Dialog 使用语义玻璃类；主消息文档、表格、VChart 和代码块保持高不透明度。
- **R5**：Composer 视觉上悬浮于文档层，但继续占据 grid row，不用 fixed bottom 遮挡内容；Inspector 继续服从现有 1280/1000/959 container concession 和 resize 行为。
- **R6**：活动流保持 DeepSeek Harness 风格的低干扰单行 disclosure；不能为 Think/Tool/Subagent 每行再包玻璃 Card。

### States, Motion And Accessibility

- **R7**：loading skeleton 几何匹配 Sidebar/Conversation/Inspector；empty、error、retry、disabled、hover、focus-visible 和 active 状态保持完整。active 仅允许约 1px transform 或 0.98 scale。
- **R8**：动画只修改 transform/opacity；持续 pulse/shimmer 只用于真实 running/loading，且在最小 Client leaf 或 CSS pseudo 上运行，不通过 React state 驱动连续动画。
- **R9**：`prefers-reduced-motion` 停止 pulse、shimmer 和非必要 transition；`prefers-reduced-transparency`、不支持 `backdrop-filter` 和 print 使用高不透明实体 fallback，仍保持同等边界、对比度与层级。
- **R10**：正文/状态文字至少 4.5:1，focus 与非文本边界至少 3:1；键盘顺序、aria-expanded、Inspector focus return、VChart 等价表格不因材质改变。

### Responsive And Source Boundary

- **R11**：1440x1000 允许非对称三层/三栏；1024x768 保持 Workspace shell；小于 768px 回落为单列/抽屉。390x844 不得产生页面级横向溢出，Composer、Inspector、富文本、表格和 VChart 不互相覆盖。
- **R12**：显式验证 1440x1000、1024x768、768x900、767x900、390x844，并保留 Inspector 1280/1000/959 concession regression。
- **R13**：使用已安装的 Tailwind v4、Geist/Geist Mono 与 `@phosphor-icons/react`；不得为装饰引入 GSAP/ThreeJS 或第二套 icon 库。
- **R14**：若新增对 DeepSeek Harness 的实质性适配，更新 source reuse ledger 和 MIT notice；纯 Data Agent CSS/material 设计明确记录为 ORIGINAL，不虚构上游来源。

## Acceptance Criteria

- [x] **AC1 / Token contract**：六个 glass token 和四个语义 material class 由 CSS contract test 锁定，Q&A 组件不包含新增 hard-coded `backdrop-blur-*` 或独立 saturate 值。
- [x] **AC2 / Material**：Sidebar、Topbar、Composer、Inspector、移动导航和 Overlay 在支持环境中具有可测半透明、20–32px blur、内高光边和染色阴影；正文/Table/VChart 是高不透明阅读面。
- [x] **AC3 / Fallback**：reduced motion、reduced transparency、无 backdrop-filter 和 print 四类 CSS fallback 可静态验证；关闭玻璃后 UI 内容、边界、focus 和操作保持可达。
- [x] **AC4 / Geometry**：真实浏览器在 1440x1000、1024x768、768x900、767x900、390x844 无页面横向溢出或 Composer/Inspector 覆盖；1280/1000/959 Inspector concession tests 不回退。
- [x] **AC5 / Interaction states**：目录、对话、Composer、Inspector 的 loading/empty/error/disabled/focus/active 仍可见；running pulse 与 skeleton 在 reduced-motion 下停用。
- [x] **AC6 / Visual language**：截图中无紫蓝 AI 渐变、霓虹、纯黑大底、Emoji 或每段内容一张玻璃 Card；字号、中文回退、Mono 数字/代码层级清晰。
- [x] **AC7 / Regression**：Web focused/full unit、typecheck、production build、scoped Biome 和 `git diff --check` 通过；SSE、Inspector、Artifact、Table/VChart 和目录 authority 行为测试不变。
- [x] **AC8 / Evidence**：保存 desktop/tablet/mobile 截图、几何断言和浏览器报告；更新 material executable spec、reuse ledger/notice 边界，完成 Trellis review 后 scoped commit/archive。

## Out Of Scope

- 暗色主题、主题编辑器、用户自定义透明度设置。
- 改写 Q&A authority、SSE、Agent dispatch、Artifact/VChart contract 或目录数据库。
- 复制 Apple、Codex、DeepSeek Harness 或 Reasonix 的品牌资产和完整产品外观。
