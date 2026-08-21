# Apple Glass Q&A Presentation — Implementation Plan

## 0. Baseline

- [x] 读取用户指定的 `design-taste-frontend` skill，固定 8/6/4 参数。
- [x] 读取 parent R52–R61/AC29–AC34、frontend design/component/type specs 与 shared reuse/cross-layer guides。
- [x] 检查 Tailwind v4、Framer Motion 和 Phosphor 已安装；本任务不新增装饰依赖。
- [x] 固定 dirty-tree baseline，运行 Web focused/full relevant baseline，启动 child task。

## 1. Material System

- [x] 在 `design-system.css` 增加六个 semantic glass tokens、四个 material classes 与 radius/shadow helpers。
- [x] 增加 `@supports` opaque fallback、reduced transparency、reduced motion 和 print rules。
- [x] 加入真实 running pulse、skeleton shimmer 的 transform/opacity-only/reduced-motion-safe CSS。
- [x] 新增 CSS contract test，禁止 Q&A chrome 散落新 blur/saturate hardcode。

## 2. Q&A Surface Mapping

- [x] 应用到 Workspace Sidebar、Topbar、Q&A view nav、Composer、Inspector 和 Mobile Workspace Nav。
- [x] 应用到移动 Conversation Directory 与确认 Dialog/Overlay；正文/Table/VChart 保持 `reading-surface`。
- [x] 保留 Composer grid row、Inspector ResizeObserver/concession、local table/chart overflow 和 focus return。
- [x] 检查 loading/empty/error/retry/disabled/hover/focus/active 状态，无每行玻璃 Card 或 Emoji。

## 3. Verification

- [x] focused tests：material contract、Workspace shell、Composer、Inspector、directory、Markdown、Artifact/Table/VChart。
- [x] Web full unit、typecheck、production build、scoped Biome、`git diff --check`。
- [x] 真实浏览器 1440x1000、1024x768、768x900、767x900、390x844；保留 1280/1000/959 concession regression。
- [x] 保存截图/几何/console 报告，验证无横向溢出、覆盖、焦点或 reduced fallback 回退。

## 4. Provenance And Finish

- [x] 新增 child reuse ledger；更新 MIT notice 只覆盖实质性 Harness 适配，明确 Glass CSS 为 ORIGINAL。
- [x] 使用 `trellis-check` 审查 correctness/a11y/performance/simplicity，修复 task-scoped P0/P1/P2。
- [x] 使用 `trellis-update-spec` 更新 frontend material executable spec。
- [x] 只 stage owned paths，创建 scoped implementation commit。
- [ ] archive child 并记录 journal。

## Owned Paths

- `apps/web/src/app/design-system.css`
- Q&A chrome 的最小 class changes：`components/layout/{workspace-shell,sidebar,workspace-topbar,mobile-workspace-nav}.tsx`、`components/qa/{chat-input,qa-inspector,conversation-directory,conversation-activity-stream}.tsx`、`app/qa/page.tsx`
- 新增/更新 task-scoped Web tests
- `apps/web/src/components/qa/DEEPSEEK_HARNESS_MIT_NOTICE.md`（仅 provenance 文案）
- `.trellis/spec/frontend/design-system.md`
- 当前 child task docs/research/artifacts

禁止纳入 Falcon artifacts、knowledge-driven semantic task、legacy attribution children、`tsconfig.tsbuildinfo` 或其他并行改动。

## Validation Result

- Web full unit：108 passed + 1 skipped；395 tests passed + 1 skipped。
- Web typecheck、production build、task-scoped Biome、`git diff --check`：PASS。
- Production build 保留 6 条既有动态文件追踪 warning，均位于 ecommerce/root-env/evals installer，不属于本任务。
- Web 全目录 `biome check .` 仍被两个并行既有格式问题阻断：`agent-profiles/route.ts` 和
  `artifacts/[artifactId]/exports/route.ts`；本任务 owned paths 全部通过，未修改并行文件。
- Trellis review 修复一个 P2：Overlay 的 saturate 收敛到统一 token，并把玻璃 chrome 的小控件半径统一到
  `--glass-control-radius`；无剩余 task-scoped P0/P1/P2。
