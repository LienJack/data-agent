# U3 Repository Research Summary

## Existing Chain and Gap

当前 Model Selector 可把选择持久化到 Conversation，U2 Resolver 也能冻结 Model Profile，Worker 会重取 exact
Config/Context Receipt。但 QA Run Route 把 Model/Datasource 请求成 `INHERIT_DEFAULT`：当 Conversation 与 Workspace
Defaults 不同时会被 U2 以 resource mismatch 拒绝。即使默认相同，`research-workflow-executor.ts` 也只显示冻结的
Provider/Model，随后运行确定性占位流程，没有注入或调用 `ModelProviderPort`，因此没有真实 M02 证据。

现有 Mastra adapter 支持 stream/tool/completed/failed，却在 binding/credential/token preflight 和真实网络前就发出
STARTED，且要求完整 token counts，不支持合法 Usage unavailable、throttled 或 outcome unknown。
`authorizeModelProviderInvocation` 的 process WeakSet 只证明同进程构造历史，不是跨事务/重启 Authority。
`apps/worker/src/mastra.ts` 当前又强制 Billing-gated wrapper，不符合本 Goal 的 no-billing 边界。

U2 Effective Config 生成 `profile_version=model-profile@<catalog config_version>`，而 static runtime binding与旧
Certification 使用 `1.0.0`；直接调用会发生 binding mismatch。DeepSeek static identity 仍写
`deepseek-v4-pro`，也与用户指定和 preflight 实测的 `deepseek-v4-flash` 不一致。

DeepSeek 官方 API 文档（[2026-04-24 V4 Release](https://api-docs.deepseek.com/news/news260424/)、
[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)，2026-08-16 复核）明确列出
`deepseek-v4-flash`、1M Context 与 384K Max Output。该官方技术规格只支撑 execution context/output snapshot；
本 Goal 已完成的五项 Credential Smoke 另行支撑 request shape、structured output、tool calling、streaming 与错误
归一化，二者不得互相冒充。Pricing 不进入 U3 readiness/hash，部署 override 固定为 `UNVERIFIED`。

## Chosen Direction

- QA Route 从 PostgreSQL Authority 读取 Conversation exact Model/Datasource revisions 并提交 RESOURCE_IDS；U2 原子
  RPC 再复验。
- 新建 framework-neutral Provider Invocation contracts 与 PostgreSQL audited store；现有 Mastra adapter只作 private
  transport delegate，并增加真实网络 suspension point。
- U2 Config + WORKER_START Context Receipt + ACTIVE lease/fence + exact committed Certification 共同决定 dispatch。
- Profile identity以 Catalog config version与model resource hash为准；adapter version单独表达；Certification加入
  provider recovery capability和system/managed deployment binding proof。
- Intent 在网络前持久化；dispatch 后有歧义即 Unknown，不盲重发；terminal 与 Usage 同事务。
- Store/Public projection 仅保存 hashes、IDs、revision、状态、技术 telemetry，不保存 raw prompt/response/secret。
- Selector readiness从商业状态解耦，只看active revision、credential、certification、context window与execution
  capability。
- U3 使用下一空 ledger `10654`，创建 Greenfield 空 Authority，无 backfill/dual-read/import。

## Existing Patterns to Reuse

- U2 Config/Context/Lease：`packages/contracts/src/runs/effective-config.ts`、`runs/runtime.ts`、
  `packages/platform/src/runs/effective-config-resolver.ts`。
- Canonical hash/UUID/time：`packages/contracts/src/common/canonical-json.ts` 与 shared primitives。
- Transport：`packages/contracts/src/ports/model-provider.ts`、`packages/agent-runtime/src/model-provider-port.ts`、
  `packages/agent-runtime/src/mastra/model-provider-adapter.ts`。
- Profile/Certification：`packages/contracts/src/providers/index.ts`、Semantic/Test Center persisted certification resolver。
- Unknown/reconcile state ideas：U6 invocation contracts只作state-machine参考；U3不复用其research Authority或commercial
  reservation semantics。

## Risks

- `platform.list_active_model_catalog` 当前版本读取 billing runtime/price-chain；U3 execution path必须由10654的
  execution-ready predicate替代，否则SQL spy会证明仍有商业依赖。
- QA catalog把 `UNBILLABLE` 当不可选原因，runtime system model缺Catalog时也标UNBILLABLE；必须删除该执行语义并
  验证Certification/Context Window。
- Model Provider现有STARTED不能当网络已dispatch证据；必须在bridge真实网络suspension点之后才由audited层标记。
- System Profile `provider_connection_id=null`，需冻结 `SYSTEM_DEPLOYMENT + certified binding hash`；managed API profile
  则冻结connection id/version/snapshot hash，不能caller自报。
- Worker/Platform barrel、run CLI/executor、Web QA store/selector与SQL static-check都是共享脏热点；只提交U3精确
  hunk，绝不纳入并行 UI、Billing 或 Semantic Candidate 改动。
