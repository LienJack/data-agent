# Falcon24 E1 Bootstrap 与验收运行手册

## 1. 适用范围与硬门

本手册只适用于一次性、可销毁的 fresh Falcon24 E1 环境。不得对含历史 Run、Artifact、Campaign、Journal、stage、
adaptive-dispatch receipt 或旧 Falcon authority 行的数据库直接执行 E1 bootstrap/activation。10775 与 10778 的空库断言失败时，
结论是 `HOLD`；禁止 truncate、跳过 migration、改写 ledger 或把旧行迁入 E1。

正式 identity 只有：

- `E1-Q1`：G1 1 次、G2 5 次、G3 5 次、G4 5 次，共 16/16；
- `E1-C1`：G5 五题 × COLD/WARM × 3，共 30/30。

任一正式 slot 第一次失败即冻结整个 attempt。不得自动 retry、resume、跳过 slot、提高预算、放宽 Oracle、替换 frozen hash 或把排障
Run 计入成绩。U7-A 未冻结最终 commit/Web build 或 CLI 尚未接受上述 E1 identity 时，不得启动正式门禁。

## 2. 代码与输入预检

在 `codex/falcon24-e1-authority-reset` 的干净、已提交 worktree 中记录：

```sh
git status --short
git rev-parse HEAD
pnpm exec tsx scripts/verify-falcon24-retained-assets.ts
pnpm sandbox:analysis:attest
pnpm sandbox:analysis:unique
pnpm typecheck
pnpm build
```

必须同时保存 commit SHA、retained manifest hash、migration 10775–10778 checksum、Operator registry digest、OpenSandbox
image/lock/SDK/implementation attestation 和 Web build identity。工作树有未提交代码、生成文件漂移或 attestation
`production_isolation_proven=false` 时只能继续 local/dev 功能验证，不能声明 production GO。

## 3. Fresh 数据库 provision

1. 新建独立数据库/环境，使用新的 workspace、principal、deployment 与 staging identity；不复用旧 Conversation/Run。
2. 通过项目 migration runner 从头应用 committed migration；不得手工复制当前数据库。
3. 在 disposable PostgreSQL 上复验完整 migration 与 assertion：

   ```sh
   infra/supabase/test-support/run-postgres-smoke.sh
   ```

4. 10778 必须证明 `agent_dispatch_*` 三张旧表与全部旧 RPC/validator 已消失；旧 RPC 调用必须返回 not found。
5. 在 bootstrap 前查询并保存零行清单：Run、Artifact、Campaign、Qualification、Context Journal、publication stage/outbox、E1
   baseline/staging/current authority 均不得带入历史行。

任何“当前数据库不是 fresh”的证据都结束本 attempt；另建 disposable 环境，不修补原库。

## 4. Secret rebind 与 E1 bootstrap

Secret 只从服务器侧重新 provision。不得把 API key、DSN、provider payload、sealed case 或临时路径写入日志、manifest、Artifact、
截图或本手册输出。local/dev bootstrap 的最小调用形式是：

```sh
DATA_AGENT_ALLOW_FALCON24_E1_BOOTSTRAP=YES \
FALCON24_E1_ENVIRONMENT=<fresh-environment> \
FALCON24_E1_MODEL_API_KEY=<server-injected-secret> \
pnpm --filter @data-agent/web bootstrap:falcon24-e1
```

同时由服务器环境提供 `DATABASE_URL`、`WORKER_DEPLOYMENT_ID`、`WORKER_TENANT_ID`、`WORKER_PRINCIPAL_ID`，必要时提供新的
`FALCON24_E1_STAGING_ID`。CLI 返回 `NOT_RUN` 或 `HOLD` 时不得手工推进 current pointer。production 环境禁止使用 disposable signer；必须
先 provision production signer/certification，并让 activation receipt 绑定最终 commit、Web build、manifest、semantic/model/profile、
Operator 与 Sandbox attestation。

## 5. 激活前检查

仅当同一 staging attempt 满足以下条件才可激活：

- retained asset 只包含批准的六类定义/配置，不含旧 runtime identity、旧 receipt 或秘密；
- 只导入并绑定 `falcon_db_24`，Published Semantic Release 覆盖指标、维度、公式、Join、粒度、时间、质量与 physical binding；
- DeepSeek provider/model/profile 已认证，SecretRef 为本环境新引用；
- Root V3 catalog、Text2SQL、generic governed analysis、independent Oracle、atomic Publisher、Trace/UI 与 cleanup 合同均绑定同一
  frozen baseline；
- 无 Direct QA、adaptive dispatch、regex router、fixed `query_kind`、template SQL、Falcon case-bound runtime 或第二 evaluator executor；
- staging recovery/replay 证明 deterministic obligation 不会重复执行，当前 pointer 尚未提前可见。

激活后 E1 immutable。任何代码、合同、migration、Prompt、Agent Card、Operator 或 Web build 变化都进入 E2，不得替换 E1 baseline。

## 6. 门禁前 L1–L6 排障

综合门禁不是调试循环。先用非计分诊断按固定顺序证明：

1. L1 Root 路由：V3 lease、exact catalog、native delegation、无 Host 关键词分类；
2. L2 SQL/数据准备：exact semantic/schema/datasource binding，`QueryEvidence -> typed Arrow` 完整；
3. L3 Governed Operator：OpenSandbox entrypoint、dependency/repair、policy、Journal、Binding Cell 与 result receipt；
4. L4 Oracle：与生产算子独立实现，KPI identity/粒度/时间/数值/图表 obligations 全匹配；
5. L5 Publisher/Trace/UI：五类 exact Artifact 原子可见，从真实问答答案进入 exact Run 轨迹，390/1440 都可展开详情和工件；
6. L6 Reclamation：数据库、management API 与 Docker observation 同时为 residual=0。

排障失败只记录诊断，不创建或 claim `E1-Q1`/`E1-C1` slot。

## 7. E1-Q1 与 E1-C1

所有命令都必须带当前 workspace/principal/deployment，并使用服务器侧严格策略：

```sh
export DATA_AGENT_FALCON24_ACCEPTANCE_EXECUTION_POLICY=falcon24-strict-zero-retry@1.0.0

pnpm --filter @data-agent/web falcon24:qualification:control manifest \
  --qualification-id=E1-Q1 --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
pnpm --filter @data-agent/web falcon24:qualification:control submit \
  --qualification-id=E1-Q1 --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
pnpm --filter @data-agent/web falcon24:qualification:control finalize \
  --qualification-id=E1-Q1 --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
```

只有同一 immutable qualification attempt 达到 16/16，才创建 `E1-C1`：

```sh
pnpm --filter @data-agent/web falcon24:analysis:control manifest \
  --campaign-id=E1-C1 --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
pnpm --filter @data-agent/web falcon24:analysis:control submit \
  --campaign-id=E1-C1 --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
pnpm --filter @data-agent/web falcon24:analysis:control finalize \
  --campaign-id=E1-C1 --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
```

Runner 必须严格串行。每个成功 slot 都要保存同源 `qa_e2e_receipt` 与 `trace_ui_receipt`，绑定 exact Conversation、Run、baseline、
commit、Web build、viewport、trace hash、Artifact ID/revision/content hash；预先存在的 Run、直接打开 trace URL、页面只有
`BLOCKED`、API 409、缺图表/表格/报告或任一 error banner 都是失败。

## 8. HOLD 与恢复

正式 slot 失败后立即停止 runner，确认 PostgreSQL attempt 已 immutable HOLD 且后续 slot 未 claim。保存首个业务失败层与错误码；
cleanup 事故单独记录，不能覆盖首失败。只有完成根因修复、相关 focused/full validation 并形成新的 scoped commit 后，才能以新的
attempt identity 从该阶段第一个 slot 全量重跑；禁止跨 attempt 拼接 16/16 或 30/30。

常用只读状态命令：

```sh
pnpm --filter @data-agent/web falcon24:qualification:control status --qualification-id=E1-Q1 \
  --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
pnpm --filter @data-agent/web falcon24:analysis:control status --campaign-id=E1-C1 \
  --workspace-id=<workspace> --principal-id=<principal> --deployment-id=<deployment>
```

## 9. Cleanup 与最终报告

停止业务执行后允许一次受控回收，但它不是题目 retry。只回收 management observation 精确证明属于该 attempt 且不再使用的
Sandbox/egress；不得删除 PostgreSQL、ClamAV、Neo4j 或其他共享服务。最终由数据库、management API、Docker 三方证明 residual=0。

最终报告必须区分：

- 观察到的 `E1-Q1` 16/16；
- 观察到的 `E1-C1` 30/30；
- local/dev 功能通过；
- `production_isolation_proven` 与 production readiness。

缺少环境级 isolation receipt 时，即使 46 个 slot 全部通过，production 结论仍是 HOLD。
