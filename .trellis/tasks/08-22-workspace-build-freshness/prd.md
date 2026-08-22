# 防止 Workspace 旧构建产物重复运行

## Goal

确保受支持的本地、Docker 与 Release 启动入口永远不会在 Workspace package 源码与构建输出不一致时继续
提供服务，并在公开错误继续脱敏的前提下，让运维能够用安全的构建身份和 persistence diagnostic 定位根因。

完整决策依据见 `docs/plans/2026-08-22-002-fix-workspace-build-freshness-plan.md`。

## Background

- Workspace package 通过 `exports` 加载 `dist`；Next/Turbopack 与 `tsx watch` 当前只监督 app 源码。
- Resolution Trace 源码已移除 `runs.active_attempt_id`，但活动 Next 进程仍加载旧 platform `dist`/chunk，导致
  `PERSISTENCE_TRANSACTION_FAILED` 重复出现。
- PostgreSQL 仍是 Authority；公开 persistence 错误必须继续脱敏；migration 只能显式执行。

## Requirements

- R1. 所有受支持 `dev*` 入口在绑定应用端口前构建并验证所选消费者的传递 Workspace dependencies。
- R2. 依赖与影响集合复用 Workspace graph 和 Turbo task graph，不维护第二份 package 白名单。
- R3. 新鲜度使用 Turbo input hash、output digest、package/export/root build metadata；mtime 不得作为 Authority。
- R4. 检测到 package build input 变化后，先停止受影响消费者，成功重建验证后自动重启；未受影响消费者不重启。
- R5. build/verify/attestation 失败时受影响服务保持下线，旧 generation 不得继续提供请求。
- R6. 根级与 package-level public `dev*` 命令保持兼容，裸 Next/tsx 仅作为受保护 raw entrypoint。
- R7. Web、Worker、Indexer、Semantic Authoring 获得 role-specific build ID 与 generation ID；build fact 与
  migration fact 分离。
- R8. 浏览器继续只收到稳定脱敏错误；服务端只记录 allowlist diagnostic fields 与安全运行身份。
- R9. 自动化覆盖 clean/stale/missing/drift/failure/recovery/shared dependency/duplicate subscriber 等路径，且测试
  不修改开发者真实 `dist`。
- R10. Docker/Release 生成并验证 portable runtime identity，且不提交 `dist` 或复制 `.git`/Turbo cache。
- R11. 启动/readiness 不自动执行 migration；Ledger 缺失或 checksum 漂移继续 fail closed。
- R12. build coordinator 不导入尚未验证的 Workspace `dist`。

## Acceptance Criteria

- [ ] stale/missing Workspace outputs 时，所有受支持 dev entrypoint 在端口绑定前失败。
- [ ] package input 变化使受影响消费者下线；build 失败期间旧进程不响应，修复后无需重启 coordinator 即可恢复。
- [ ] build 前后 input hash 变化、output digest mismatch 和 invalid/truncated attestation 均不提交新 generation。
- [ ] Web/Worker/Indexer health 暴露 opaque build/generation ID；Semantic Authoring 在启动日志记录同类 identity。
- [ ] `PERSISTENCE_TRANSACTION_FAILED` 公开 payload 不变，服务端日志可按 operation/SQLSTATE/build/correlation 定位。
- [ ] 当前 Resolution Trace 回归不再执行 `runs.active_attempt_id` 旧查询。
- [ ] Docker/Release 对 stale 或被篡改输出失败关闭，并携带 portable identity。
- [ ] `pnpm dev` 仍不自动迁移；所有验证使用 scoped tests，所有实施单元独立提交。

## Out of Scope

- 不新增 `runs.active_attempt_id`，不改变 `run_attempts` Authority。
- 不修改业务 Q&A/Resolution Trace 领域逻辑，不自动运行 migration，不执行数据清理或回填。
- 不增加 dev-only source exports，不提交 `dist`/`.next`/`.turbo`/`tsbuildinfo`。
- 不保证裸 `next dev`、裸 `tsx watch` 或裸 `node dist/...` 命令受保护。

## Open Questions

无阻塞产品或范围问题。Turbo 2.10.6 dry-run identity 字段和 watcher audit 间隔属于实施验证项，不改变上述行为。
