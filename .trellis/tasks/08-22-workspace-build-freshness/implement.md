# Implementation Plan

## Execution Order

### U1 — Build Integrity Domain

- [ ] 新增 Workspace build integrity helper、reverse impact、atomic attestation 与 portable identity contract。
- [ ] 补齐 Web `.next/**` Turbo output contract。
- [ ] 用临时 fixture 覆盖 stable/stale/missing/output mismatch/build-race/unknown schema，不触碰真实 `dist`。
- Validation:
  - `pnpm exec vitest run tests/workspace-build-integrity.spec.ts`
  - `pnpm --filter @data-agent/contracts exec vitest run test/runtime-build-identity.spec.ts`
- Commit: `feat(tooling): attest workspace package builds`

### U2 — Coordinator and Guarded Entrypoints

- [ ] 扩展 local runtime supervisor，收敛 root/package public commands 与 raw guarded commands。
- [ ] 实现 initial build、watch invalidation、affected stop/rebuild/restart、Blocked recovery 和 periodic audit。
- [ ] 覆盖 command compatibility、expected/unexpected exit、signals、failure recovery 和 no-port-before-proof。
- Dependency: U1
- Validation: `pnpm test:dev-runtime`
- Commit: `fix(dev): rebuild and restart stale workspace consumers`

### U3 — Runtime Identity and Health

- [ ] Web ready、Worker/Indexer live 和 Semantic Authoring startup log 消费 strict portable identity。
- [ ] build/generation 与 migration readiness 分离，public response 只含 opaque identity。
- [ ] 覆盖 missing/malformed/role mismatch/no-store/no-secret。
- Dependency: U1
- Validation:
  - `pnpm --filter @data-agent/web exec vitest run test/runtime-build-identity.spec.ts`
  - `pnpm --filter @data-agent/worker exec vitest run test/runtime-build-identity.spec.ts test/semantic-relationship-indexer.spec.ts test/semantic-authoring-worker-runner.spec.ts`
- Commit: `feat(runtime): expose verified build identity`

### U4 — Safe Persistence Diagnostics

- [ ] 新增 platform idempotent safe subscriber，并从 Web instrumentation 与 Worker/Indexer/Authoring bootstrap 注册。
- [ ] 保持 public persistence error snapshot 不变，覆盖 duplicate subscribe、logger failure 与 secret/raw-error exclusion。
- Dependency: U3
- Validation:
  - `pnpm --filter @data-agent/platform exec vitest run test/persistence/transaction.spec.ts test/persistence/diagnostic-logger.spec.ts`
  - `pnpm --filter @data-agent/web exec vitest run test/operations-diagnostics.spec.ts`
  - `pnpm --filter @data-agent/worker exec vitest run test/persistence-diagnostics.spec.ts`
- Commit: `feat(observability): log safe persistence diagnostics`

### U5 — Docker, Release and Runbook Gates

- [ ] Docker builder 生成/验证 portable identity，runner 只复制安全投影；release gate 拒绝 stale/tampered output。
- [ ] 扩展现有 Docker/release contract tests，加入 Resolution Trace 旧 SQL 回归。
- [ ] 更新 local/deployment runbook 和 Trellis local runtime spec。
- Dependency: U2, U3, U4
- Validation:
  - package-scoped suites，禁止根 Vitest 扫描 `.next/standalone`
  - `pnpm build` + workspace integrity gate
  - Docker contract/smoke
  - `pnpm verify:release`
- Commit: `test(release): reject stale workspace build outputs`

## Quality Gates

- 每个单元开始前记录 owned paths；只 stage 本单元文件。
- 每个单元 tests 通过后执行 `git diff --cached --check` 再提交。
- 完成 U2/U3 后检查跨层 identity contract；完成 U4/U5 后运行全范围回归与代码审查。
- 不 stage 现有 `next-env.d.ts`、`tsconfig.tsbuildinfo`、Falcon artifacts 或其他 Trellis task。

## Hard Blocker

若 Turbo 2.10.6 无法提供稳定 task input identity，且无法在不复制构建规则的情况下得到等价内容证明，停止 U1，
记录证据并回到方案评审。禁止以 mtime、手工 build 或 watcher 信任替代。
