# Falcon24 历史 E1 Bootstrap 退役与 E3 → E4 恢复运行手册

## 1. 适用范围与当前硬停点

历史 `bootstrap:falcon24-e1` 已退役。它不会再创建 generation 1、写 semantic projection 或连接数据库：

- 未设置 `DATA_AGENT_ALLOW_FALCON24_E1_BOOTSTRAP=YES` 时返回 `NOT_RUN`；
- 设置确认变量后仍返回
  `HOLD / FALCON24_E1_BOOTSTRAP_RETIRED_SEMANTIC_SUCCESSOR_REQUIRED / NO_GENERATION_1_WRITES`；
- 唯一恢复入口是 exact E3 环境上的 `finalize:falcon24-authority`。

当前专用执行目标固定为容器 `data-agent-falcon24-e1-e81a29c6`、数据库 `data_agent`。W1-W7 已完成，但本手册中的 W8/W9/W10
命令只有在用户再次明确授权专用数据库 migration 与 E4 activation 后才能执行。授权前禁止连接该数据库、应用 migration、stage
successor、创建 diagnostic/qualification/campaign attempt 或写任何 gate 事实。

正式 identity 只有：

- `E4-Q1`：G1 1 次、G2 5 次、G3 5 次、G4 5 次，共 16/16；
- `E4-C1`：5 题 × COLD/WARM × 3，共 30/30。

任何正式 slot 第一次失败即 HOLD；不得 retry、resume、跨 attempt 拼接或用 API-only 证据代替真实答案页进入 exact Run Trace UI。

## 2. W8 授权前只读预检

在 `codex/falcon24-e1-authority-reset` 的干净、已提交 worktree 中记录：

```sh
git status --short
git rev-parse HEAD
git stash list --format='%gd %s'
docker ps --format '{{.Names}}' | sort
pnpm exec tsx scripts/verify-falcon24-retained-assets.ts
pnpm sandbox:analysis:attest
pnpm sandbox:analysis:unique
```

Retained verifier 的 `READY` 必须同时给出 `manifest_origin_commit=5eb4714e13ef3daad44ae79412832e6108c17902`、
`verified_historical_semantic_file_count=3` 与 `verified_current_retained_file_count=31`。三个
`current_semantic_drift_files` 是 generation 2 的显式前向变化：旧 E1 bytes 由 origin commit 的 Git blob 证明，当前 build 则由后续
build attestation 证明；不得要求当前源码重新等于 E1，也不得修改旧 manifest 消除 drift。

预期审计 stash 为 `audit/rejected-generation1-repair-2026-08-28`；它不得 restore、drop 或执行。Docker 清单只能包含既有
`data-agent-postgres`、`data-agent-clamav`、`data-agent-neo4j` 和唯一专用
`data-agent-falcon24-e1-e81a29c6`，不得再创建数据库容器。

必须保存 final commit、Web/Worker build identity、10783/10790/10791 checksum、retained manifest hash、Operator registry digest 与
OpenSandbox attestation。`production_isolation_proven=false` 时即使功能链通过，最终 production 结论仍为 HOLD。

## 3. W8：E3 → generation 2 / E4 原子激活

只有获得新的明确授权后，才先对专用数据库做只读审计：

1. 确认 migration frontier 仍为 10782；
2. 导出 generation 1 source/projection bytes、E1-E3 baseline/receipt/run/gate 的 count、identity 与 hash；
3. 核对 current exact 为 E3，semantic pointer/runtime/defaults exact 为 generation 1；
4. 只应用已提交并验证的 forward migrations，禁止手工 SQL、backfill 或历史 UPDATE/DELETE。

若只读审计发现重构前旧数据损坏，先按以下边界分类：generation 1 release/projection/pointer 历史和 E1/E2/E3
baseline/receipt/activation/Run/gate/Artifact/diagnostic 永不丢弃；不在该集合、未被 current closure/receipt 引用且不参与完成证据的
旧非权威数据可以丢弃。丢弃必须通过已审查 lifecycle 或新的 forward migration，并保存分类依据与前后 count/hash；禁止临时手工 SQL，
也禁止借此改写受保护历史。

Finalizer 的服务器环境必须提供以下引用；秘密、DSN 与 provider payload 不得写入日志或 Artifact：

```sh
export DATA_AGENT_ALLOW_FALCON24_AUTHORITY_ACTIVATION=YES
export FALCON24_AUTHORITY_EPOCH=E4
export FALCON24_SUCCESSOR_CHANGE_SET_ID=<reviewed-change-set-uuid>
export FALCON24_SUCCESSOR_CHANGE_SET_HASH=<sha256>
export FALCON24_SUCCESSOR_REVIEW_ID=<approved-review-uuid>
export FALCON24_SUCCESSOR_REVIEW_HASH=<sha256>
export FALCON24_WEB_BUILD_IDENTITY_FILE=<absolute-web-build-identity-json>
export FALCON24_WORKER_BUILD_IDENTITY_FILE=<absolute-worker-build-identity-json>
export FALCON24_BUILD_ATTESTATION_FILE=<absolute-build-attestation-json>
export FALCON24_ENVIRONMENT=<exact-environment>

pnpm --filter @data-agent/web finalize:falcon24-authority
```

该命令固定执行：exact E3/gen1/defaults preflight → 唯一 reviewed successor publisher → shared validator → deterministic Worker smoke →
proof v2 → E4 supporting staging → 单一 combined PostgreSQL transaction → production-port readback。CLI 不接受 projection payload/digest，
也不调用旧 defaults writer、generation-1 equality proof 或普通 `epoch.activate`。

成功结果必须同时证明：

- current authority 为 E4；
- semantic pointer、runtime 与 workspace defaults 都指向同一 generation 2 exact release；
- successor stage 为 `PROMOTED`，validation/smoke/proof/activation receipt hash 域各自正确；
- generation 1 与 E1/E2/E3 bytes/count/hash 与迁移前完全相同；
- `production_gate` 仍按真实 isolation 状态 fail closed。

任一步返回 HOLD 时整笔 activation 必须保持 all-old；禁止补写、回退历史或第二次调用别的 activation 路径。提交后 readback 不一致是
严重故障，只冻结执行；若需改 frozen closure，前进 E5。

## 4. W9：单次非计分 Diagnostic

Diagnostic 固定业务问题为：

> 最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。

Root 运行时使用动态 Tool Loop：每轮只基于当前对话与已经返回的安全 Tool Result 决定下一次调用或最终答案；Host 只校验当前调用。
完成后记录的 `SEMANTIC → TEXT2SQL → SQL → QUERY_EVIDENCE → TYPED_ARROW → PYTHON_OPERATOR → ANALYSIS_REPORT → CHART`
是观察证据，不是 Host 预先选择的业务链。上一步 Artifact 只通过普通 `input_artifact_refs` 进入后续调用。

设置零重试策略并创建一个 exact active attempt：

```sh
export DATA_AGENT_FALCON24_ACCEPTANCE_EXECUTION_POLICY=falcon24-strict-zero-retry@1.0.0

pnpm --filter @data-agent/web falcon24:diagnostic:control manifest \
  --attempt-id=<diagnostic-attempt-uuid> \
  --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
```

通过真实 Q&A composer 提交，随后从答案页进入 exact Run Trace UI；禁止直达 trace URL：

```sh
pnpm --filter @data-agent/web falcon24:diagnostic:control submit \
  --attempt-id=<diagnostic-attempt-uuid> \
  --browser-session=<isolated-session> --web-base-url=<https-url> --browser-width=1440 \
  --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>

pnpm --filter @data-agent/web falcon24:diagnostic:control trace \
  --attempt-id=<diagnostic-attempt-uuid> \
  --browser-session=<same-session> --web-base-url=<https-url> --browser-width=1440 \
  --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
```

Trace 必须从同一答案页证明五个 exact Artifact 可打开、表格/折线图/报告可用、无 `BLOCKED`/error banner。随后由 Worker 独立回收该
Run 的 sandbox，再由 diagnostic authority 原子验证 UI receipts、Artifact closure 与 residual=0：

```sh
pnpm --filter @data-agent/worker falcon24:diagnostic:reclaim \
  --attempt-id=<diagnostic-attempt-uuid> \
  --output=artifacts/falcon24-agent-analysis/diagnostic-reclamation.json

pnpm --filter @data-agent/web falcon24:diagnostic:control complete \
  --attempt-id=<diagnostic-attempt-uuid> --browser-width=1440 \
  --reclamation-receipt=artifacts/falcon24-agent-analysis/diagnostic-reclamation.json \
  --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
```

失败若要求修改 frozen closure，必须进入 E5；若仅是已证明的外部依赖且 closure 未变，可用新的 attempt ID，绝不能 resume 同一 Run。

## 5. W10：E4-Q1 与 E4-C1

只有同一 E4/gen2/build 的 diagnostic receipt 为 PASS，才能开始 E4-Q1。Manifest 必须显式绑定该 receipt：

```sh
pnpm --filter @data-agent/web falcon24:qualification:control manifest \
  --qualification-id=E4-Q1 --attempt-id=<qualification-attempt-uuid> \
  --diagnostic-attempt-id=<passed-diagnostic-attempt-uuid> \
  --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
```

对 ordinal 0..15 严格串行执行 `submit → trace → finalize`：

```sh
pnpm --filter @data-agent/web falcon24:qualification:control submit \
  --qualification-id=E4-Q1 --attempt-id=<qualification-attempt-uuid> --ordinal=<0..15> \
  --browser-session=<isolated-session> --web-base-url=<https-url> --browser-width=<390-or-1440> \
  --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
pnpm --filter @data-agent/web falcon24:qualification:control trace \
  --qualification-id=E4-Q1 --attempt-id=<qualification-attempt-uuid> --ordinal=<0..15> \
  --browser-session=<same-session> --web-base-url=<https-url> --browser-width=<390-or-1440> \
  --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
pnpm --filter @data-agent/web falcon24:qualification:control finalize \
  --qualification-id=E4-Q1 --attempt-id=<qualification-attempt-uuid> --ordinal=<0..15> \
  --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
```

只有单一 immutable E4-Q1 attempt 达到 16/16 后，才创建 E4-C1，并对 5 题 × COLD/WARM × 3 的 30 个 ordinal 严格执行同样的
`submit → trace → finalize`：

```sh
pnpm --filter @data-agent/web falcon24:analysis:control manifest \
  --campaign-id=E4-C1 --attempt-id=<campaign-attempt-uuid> \
  --qualification-attempt-id=<winning-qualification-attempt-uuid> \
  --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
```

每个成功 slot 必须绑定 exact Conversation、Run、E4 baseline、gen2 release、commit、Web build、viewport、trace hash 与五个 Artifact。
首个业务失败立即确认 attempt 为 immutable HOLD 且后续 slot 未 claim；cleanup 失败单独记录，不能覆盖首失败。

## 6. 最终报告

最终报告必须逐项给出可复核 identity/hash 与实际观察值：

- generation 1/E1-E3 未变；
- generation 2/E4 exact identities 与 combined activation receipt；
- 单次 diagnostic PASS、真实答案页 Trace UI 与 residual=0；
- E4-Q1 16/16；
- E4-C1 30/30；
- `production_isolation_proven` 与 `production_gate` 的真实状态。

缺少任一证据不得声称完成；缺少环境级 isolation receipt 时 production 仍为 HOLD。
