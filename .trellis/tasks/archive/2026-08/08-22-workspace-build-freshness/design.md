# Technical Design

## Architecture

现有 `scripts/local-dev-runtime.ts` 升级为唯一 dependency-aware coordinator；
`scripts/lib/workspace-architecture.ts` 继续拥有模块图，新增 build-integrity helper 负责 Turbo task identity、
output digest、reverse impact 与原子 attestation。Coordinator 本身不导入 Workspace package exports。

```text
supported dev command
  -> resolve consumer dependency graph
  -> capture Turbo input hashes
  -> filtered dependency build
  -> verify outputs and stable pre/post hashes
  -> atomic full attestation + portable identity
  -> guarded Next/tsx process

package input invalidated
  -> stop impacted consumers
  -> rebuild/verify
  -> restart on success or remain offline on failure
```

## Contracts

- Full attestation 位于 Git-ignored `.turbo/data-agent-dev/`，包含 schema version、generation ID、per-role build ID、
  consumer/package task identities、output digests、root inputs 和 non-secret provenance。
- Portable identity 由 `@data-agent/contracts` 的 strict schema 定义，仅携带进程需要的安全投影；本地通过受控
  file/env 传递，Docker runner 复制固定只读文件。
- `generation_id` 表示一次协调周期；`build_id` 精确绑定 consumer role 的依赖输出，因此不同 role 不要求相同。
- migration frontier 是运行时 Authority fact，不进入 build hash，也不由 manifest 伪造。

## Process Lifecycle

- Initial build/verify 成功前不 spawn app。
- 首个 observed invalidation 先停止 affected children，再 debounce/coalesce build。
- expected restart 不触发现有 peer-cascade；unexpected child exit 仍终止监督组。
- build failure 进入可恢复 Blocked 状态，coordinator 保持 watcher；下一次变化或显式 retry 可恢复。
- fast filesystem invalidation 与 periodic task-hash audit 共享同一状态机。

## Diagnostics Boundary

Platform 现有 persistence diagnostic channel 是唯一事件来源。新增幂等 subscriber 只投影：operation、correlation、
error class、SQLSTATE、marker、process role、build ID 和已核验 migration frontier。禁止序列化 raw Error、SQL、参数、
stack、DSN、credential 或 provider payload。公开 transaction error code/message 保持不变。

## Compatibility and Rollout

- Root/package public `dev*` script 保持名称；内部 Next/tsx command 改为 coordinator-only raw script。
- app 自身源码继续使用 Next/tsx HMR；仅 Workspace package/build inputs 触发 generation rebuild。
- Turbo 为 Web build 补充 `.next/**` 输出并排除 `.next/cache/**`；package/Worker 继续使用 `dist/**`。
- Docker wrapper/CI 显式传入 Git SHA/dirty provenance，不把 `.git` 复制进 build context。
- 不提供 observe/bypass 模式；门禁从 U2 起默认 fail closed。

## Rollback

每个 U-ID 独立提交。若 U1 的 Turbo task identity 不稳定，停止实施并回到设计评审；不得降级为 mtime。后续单元
出现回归时回退对应 scoped commit，不能恢复“旧 generation 继续服务”或隐式 migration。
