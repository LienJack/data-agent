# Apple Glass Q&A Presentation — Design

## 1. Existing Geometry Is Authority

本任务在现有 `WorkspaceShell -> Sidebar + WorkspaceTopbar + QAPage + MobileWorkspaceNav` 上做表达层改造。`qa-page-frame`、`computeInspectorColumns`、Composer row、Inspector target/store 与 Conversation Directory projection 都不改变。视觉层不得重新计算 Run、Conversation 或 Artifact 状态。

## 2. Material Model

```text
Canvas              --color-bg-canvas + subtle neutral light field
  Reading plane     Assistant Markdown / Table / VChart / code, near-opaque
  Glass chrome      Sidebar / Topbar / view switcher / Composer / Inspector
  Overlay glass     mobile directory / confirmation Dialog / popover
```

`design-system.css` 是唯一 material owner：

```css
--glass-fill;
--glass-fill-strong;
--glass-border-inner;
--glass-shadow-tint;
--glass-blur;
--glass-saturate;
```

语义类组合：

- `.glass-surface`：普通 chrome，低透明 fill、折射边、inset highlight、20–32px blur。
- `.glass-surface-strong`：Composer/Inspector 等前景层，提高 fill 不透明度和阴影分离。
- `.glass-overlay`：Backdrop 与抽屉/Dialog 的 material pairing；Backdrop 自身只用低 blur。
- `.reading-surface`：正文、数据和代码的近实色面，不继承 backdrop blur。

不支持透明时通过 `@supports not ((backdrop-filter: ...) or (-webkit-backdrop-filter: ...))` 切为 opaque fill；Safari/系统辅助功能通过 `@media (prefers-reduced-transparency: reduce)` 使用同一 fallback；print 移除 blur/shadow 并使用白色实体表面。

## 3. Component Mapping

| Target | Material | Geometry rule |
| --- | --- | --- |
| `Sidebar` | glass surface | desktop 248/64px width unchanged |
| `WorkspaceTopbar` | glass surface strong | 52px row unchanged, sticky layer only |
| Q&A view nav | glass surface | grid row 1, not another card |
| `ChatInput` outer | transparent stage | retains row 3 and safe padding |
| Composer editor | glass surface strong | 18–22px radius, text area stays transparent |
| `QAInspector` | glass surface strong | existing ResizeObserver and concession widths unchanged |
| `MobileWorkspaceNav` | glass surface strong | safe-area and 64px height unchanged |
| mobile directory/Dialog | glass overlay | drawer/dialog 20–24px radius where floating |
| Markdown/Table/VChart | reading surface | local overflow and exact Artifact identity unchanged |

## 4. Motion And States

- Global transition remains cubic-bezier and only covers color/background/border/opacity/shadow/transform.
- Running dot uses a CSS pseudo ring/pulse attached to actual sending state. Skeleton shimmer is a CSS background-position animation isolated to skeleton nodes.
- `prefers-reduced-motion` collapses these animations to a static state.
- No magnetic cursor effect is introduced: this is a high-frequency data UI and continuous mouse tracking adds no task value.
- Loading skeletons keep final panel geometry; error/empty components remain native text and buttons, not decorative placeholders.

## 5. Accessibility And Contrast

- Text colors continue using the existing verified off-black/cool-neutral tokens; glass fill never carries body text below the existing contrast.
- Focus uses the existing 2px deep-green outline with offset. Glass borders must remain visible in opaque fallback.
- `backdrop-filter` is enhancement only. DOM order, native buttons, disclosure semantics, tab order and Inspector focus return stay unchanged.
- No material is the sole status signal; status continues to include text/icon/public code。

## 6. Responsive Acceptance

The browser matrix is measured against `documentElement.scrollWidth <= clientWidth` and component bounding rectangles:

- 1440x1000: desktop Sidebar + message document + optional Inspector.
- 1280/1000/959: existing container concession exact regression.
- 1024x768: narrow desktop shell with no overlap.
- 768x900 vs 767x900: Inspector breakpoint boundary and mobile single-column transition.
- 390x844: mobile topbar/nav/directory, Composer row and local table/chart overflow.

## 7. Source And Reuse Boundary

- DeepSeek Harness fixed reference remains `47f943859bef60e4160492346772ded9b24f765a`, MIT.
- Existing event/disclosure/Inspector baseline/live and selection boundaries remain ADAPTED and stay covered by the current notice.
- Glass token definitions, CSS fallbacks and Data Agent material mapping are ORIGINAL. No Apple/Codex/Reasonix source or private protocol is copied.
- The child reuse ledger records unchanged upstream-derived targets plus the new ORIGINAL presentation targets so provenance stays explicit.

## 8. Validation And Rollback

Validation: CSS/component contract tests, existing Inspector layout/store tests, Conversation Directory/Markdown/Artifact/VChart tests, Web full unit/typecheck/build, scoped Biome, real browser screenshots and geometry checks.

Rollback is token-first: setting glass fills opaque and blur to zero restores the prior material without changing component geometry or authority. Component class changes can then be reverted independently; no database rollback exists because this task has no persistence change.
