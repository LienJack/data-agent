# Q&A Activity Stream and Safe Rich Text — Implementation Plan

## 1. Baseline And Reference

- [x] 记录 dirty worktree，隔离 Falcon、知识库任务、生成缓存和 archived design 改动。
- [x] 固定 DeepSeek Harness/Reasonix commit、graph freshness、MIT license 与采用/改造/拒绝结论。
- [x] 运行 current assembler/disclosure/Inspector/store/Web unit/typecheck baseline。
- [x] 检查 Web `package.json` 后安装 `react-markdown`、`remark-gfm`、`rehype-sanitize`，只修改 Web manifest 与 root lockfile。

## 2. Safe Rich Text

- [x] 新增 `SafeAssistantMarkdown`、URL policy、Artifact href identity helper 与显式 sanitize schema。
- [x] 实现 H2–H5 mapping、CJK typography、list/task list、blockquote、code、GFM table、blocked image 和 local overflow。
- [x] 将 activity text block、legacy Assistant/Report/Hypothesis 统一接入 renderer；用户消息继续纯文本。
- [x] renderer tests 覆盖完成态、streaming incomplete syntax、XSS/dangerous URL/image、authorized/forged Artifact link。

## 3. Activity And Deferred UX

- [x] 收紧 ProcessDisclosure/AgentDisclosure 为 Harness 同类低干扰单行，保留所有 public status/duration/error/a11y。
- [x] 确保实际 Agent subset、one-level owned Tool/Artifact、sibling Inspector action 和无空 Agent placeholder。
- [x] 增加 terminal/authorized-artifact pure projections，保证 replay/SSE 仍使用同一 block IDs。
- [x] `api-client` 验证 deferred receipt 并抛 typed error；QA store 显示 BLOCKED public result，不创建 Run/SSE/假 Agent。
- [x] 补充 assembler/component/store/API regression，未知或 forged 409 继续失败关闭。

## 4. Validation

```bash
pnpm --filter @data-agent/web exec vitest run \
  test/qa-event-assembler.spec.ts \
  test/process-disclosure.spec.tsx \
  test/safe-assistant-markdown.spec.tsx \
  test/chat-message-activity.spec.tsx \
  test/qa-deferred-admission.spec.ts
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web test:unit
pnpm --filter @data-agent/web build
pnpm test:contract
```

- [x] 使用真实 Web + Worker + PostgreSQL conversation 验证 DIRECT、Text2SQL-only、Text2SQL+Report、DEFERRED。
- [x] 浏览器验证 1440x1000 与 390x844：折叠/键盘、CJK/代码/链接、Inspector focus、Composer/no overflow。
- [x] 更新 Harness reuse ledger、MIT notice 与 frontend executable spec。
- [x] 使用 `trellis-check` 完成跨层、安全、a11y、回放和简化 review，修复 task-scoped P0/P1/P2。
- [x] 仅暂存 child owned paths，提交、归档并记录任何外部 HOLD。

## Owned Paths

- `apps/web/src/components/qa/**` 中 Activity/Rich Text/Inspector 最小改动及 tests
- `apps/web/src/lib/qa-event-assembler.ts`、`api-client.ts`、`qa-store.ts`、`qa-types.ts` 及 focused tests
- `apps/web/package.json`、root `pnpm-lock.yaml` 的三项 Markdown 依赖变化
- `.trellis/spec/frontend/{design-system,agent-public-events,component-guidelines}.md` 的可执行规则
- 当前 child task docs/research/evidence

禁止纳入其他 Q&A children、Falcon artifacts、知识库任务、`next-env.d.ts`、`tsconfig.tsbuildinfo` 或 archived task 的未归属改动。
