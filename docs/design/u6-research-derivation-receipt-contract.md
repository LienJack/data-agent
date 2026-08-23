# U6 Research 派生回执与输入水位合同

> `FROZEN_DESIGN_CONTRACT / TYPESCRIPT_WIRE_IMPLEMENTED` ·
> `u6-research-derivation-receipt@1.0.0`
>
> 本文拥有五类 Receipt 的表、事务、锁与 currentness；exact Hash/v2 Wire 取
> `u6-research-derivation-wire-contract.md`，业务 v1 Wire 取
> `u6-research-wire-payload-contract.md`；平台结果/错误与 SQL Owner/RLS/GRANT/Inventory
> 取 Platform、Database Surface 合同；20 张新增 relation 的 exact 存储与 Catalog 取
> `u6-c2-physical-schema-descriptor-contract.md`。
>
> 基线 `data-agent@fe212f1`。TS Wire 已实现，本切片同步 Candidate Receipt v2 Head
> binding；DB 表、`10600`、PG17 parity、三个正向 Readiness Root 未实现，不算生产完成。

## 1. 问题、范围与不变量

删除 Root 固定拒绝会把 caller JSON 升为不可变终态。

本文固定五条不变量：

1. Agent、Mastra Workflow、API、Checkpoint、Redis 与进程内 brand 都不是派生真值；
2. TS/PG Research Hash 消费相同 UTF-8 bytes 与 golden vector；
3. Receipt 由 DB 持久化、约束、排序、重算并控制 currentness；调用方不能直接
   INSERT/UPDATE/DELETE 或选择有利的历史 Receipt；
4. C2a 只开放 `PARTIAL|NEEDS_MORE_RESEARCH|INCONCLUSIVE`。`STOP_READY`、Publish 与
   Consume 不因 C2a 可达；
5. 设计、Synthetic Oracle、PG 与业务证据分层；本文通过不代表 Migration、
   Hosted/Docker 或产品通过。

## 2. Hash 与 v2 Wire 路由

跨运行时值域、golden/reject vector、Reference 拒重顺序、Coverage/Stop v2 exact Schema、
Enumerator Attestation 与逐 kind hash domain 只取 Derivation Wire，不复制 codec。

## 3. DB-owned Receipt 共同包络

五类主表均展开 `S=(app_id,tenant_id,environment)`；共同包络与 kind strict object 取
Derivation Wire §6，DB 列不得省略、改名或接受额外字段。“五类表”是五张 Receipt
semantic parent；15 张 core semantic table 外还须安装 Physical Schema Descriptor
冻结的 5 张 parent-specific companion。

共同关系合同：

- PK 为 `(S,receipt_id)`；UQ 为
  `(S,run_id,issuer_principal_id,idempotency_key)`，并提供 exact FK target
  `(S,run_id,receipt_id,receipt_hash)`；
- 每张 kind table 另有 semantic UQ `(S,run_id,protocol_version,input_hash)`；同版本/输入
  只能产生一个输出，不得用
  `(input_hash,output_hash)` 放行两个不同输出；
- FK exact Run、retained Membership，以及
  `(S,issuer_capability_id,issuer_authority_epoch,issuer_principal_id)`；
- Reference 保存 strict `jsonb` 投影及规范 identity/类型/revision/content hash 列并建
  exact FK；variable-length Ref 逐元素进 parent-specific companion。JSONB 无 FK，不能
  是唯一完整性来源；
- `committed_at` 的 hash material 是数据库生成并原样返回的 UTC RFC3339 字符串，固定六位
  小数；`receipt_hash=research_kernel_sha256(receipt domain, all common and kind fields
  except receipt_hash)`；
- 同键同 input 返回已持久结果，同键异 input 返回
  `RESEARCH_DERIVATION_RECEIPT_CONFLICT`；事务失败零 Receipt；
- Receipt 仅 append。普通 RPC 无 UPDATE/DELETE；Lifecycle Cleanup 按 U6 Cleanup
  Inventory 删除整个 Scope，不把业务可变性引入 Receipt；
- Budget Snapshot 由专用 RPC 先签发；Root 不收 caller receipt selector，从 exact current
  Stop/Coverage 取得同一 Binding。其余 Receipt 由 Root 唯一生成；缺失、
  多候选或 current mismatch 都拒绝。

唯一 SQL owner 是 `data_agent_u6_data_owner`，唯一写入口为
`data_agent_u6_rpc_owner` 的 `SECURITY DEFINER SET search_path=''` 函数持有。
普通 Backend、`service_role`、Browser、Agent、Job 均无表 DML；internal hash/resolve
helper 也不向其 GRANT EXECUTE。所有表 `ENABLE + FORCE RLS`，策略仅允许 exact Owner
Scope；RLS 不替代 FK、CHECK、函数内 Authority。

语义派生由版本化 deterministic Kernel/Enumerator 完成；DB 只负责 canonical replay、
引用/跨字段/分支校验、Authority provenance 与 currentness。SQL 无法重算的 EIG 等值走
§5.2 受控 Enumerator/Attestation；Agent 自报无效。

## 4. BudgetLedgerReceipt

### 4.1 权威输入、事件水位与表

新增 immutable `research_budget_policy_versions` 与 current
`research_budget_policy_heads`。每个 Scope 必须由 Provisioner 显式安装 policy；
缺 Head 不使用隐式默认值。Policy 固定 `limits`、`top_up_allowed`、version/hash。

仅 `reservation_seq` 不足以形成水位：旧 Reservation 的 Begin/Settle/Cancel/Expire/
Abandon 改变用量却不推进 `next_reservation_seq`。故扩展
`research_resource_run_heads`：

```text
next_budget_event_seq bigint >= 1
next_step_seq bigint >= 1
budget_epoch bigint >= 0
budget_epoch_state ACTIVE | LEGACY_BUDGET_EPOCH_UNPROVABLE
budget_started_at timestamptz|null
last_budget_event_hash Sha256|null
```

`ACTIVE` 要求 `budget_epoch>=1` 且 time/hash 非空；legacy 要求 epoch=0 且二者为空，
任何 Receipt/positive Root 均拒绝。`10600` 将既有 Run 标为 legacy：Head 原位标记；缺
Head 则插入 seq=1 legacy Head，不猜历史时间。仅新 Run 可由首个 current
`ResearchBrief@2` 初始化 active epoch。

新增 append-only `research_budget_events`。`BUDGET_OPENED` 及每次
Reserve/Begin/Settle/Cancel/Expire/Abandon/`STEP_BEGIN` 均与业务 mutation 同事务追加；
UQ `(S,run_id,source_operation_kind,source_operation_id)` 保证 replay 不推进 seq。事件存
reservation/step identity、actual/hold before-after、uncertainty before-after、
previous/event hash 与 DB time。Receipt 同时绑定：

- `evaluated_through_reservation_seq=next_reservation_seq-1`；
- `evaluated_through_budget_event_seq=next_budget_event_seq-1`；
- `evaluated_at` 与 `budget_started_at`；
- exact Brief、Runtime limit、Tenant Policy；
- active/outcome-unknown/abandoned exact set hash。

Head 不由首次 Reserve 懒创建。首个 current `ResearchBrief@2` 事务锁 Run 后创建
`budget_epoch=1`、`budget_started_at=transaction_timestamp()` 的 Head 与
`BUDGET_OPENED` genesis；无 Reservation 的 Stop 也有 DB 时间起点。

`begin_research_step(jsonb)` 的 exact Input/Result 取 Derivation Wire §6；它要求 active
Attempt/Fence，UQ `(S,run_id,logical_step_id)` 与
`(S,run_id,principal_id,idempotency_key)`；同 logical ID/input replay 不重复计数，
异 input 冲突。它在 `Run→Outbox→Attempt→Resource Head` 后追加 `STEP_BEGIN`，实际
`steps+1`。每次 MODEL/SQL Reserve 须绑定已提交 `logical_step_id`；retry 复用 step，
fork/new logical work 用新 ID，Agent 内存计数无 Authority。

`research_step_operations`：PK `(S,step_operation_id)`；UQ
`(S,run_id,budget_epoch,logical_step_id)`、`(S,run_id,principal_id,idempotency_key)`；保存
独立 `step_seq`、kind/input hash、parent logical ID、Outbox/Attempt/Fence、Budget Event
seq/Hash、DB time。Head 锁内分别分配/推进 `next_step_seq`、`next_budget_event_seq`，
两者可不等；parent nullable self-FK、Attempt exact composite FK 均 immediate，parent 同
epoch 且满足
`parent.step_seq < child.step_seq`。`10600` 给 Reservation 增加
`budget_epoch`（legacy=0）与 `logical_step_id`：active epoch 的 MODEL/SQL 必须非空并以
`(S,run,epoch,logical_step_id)` exact FK 到 Step；TOOL/legacy 行可空，但 legacy Head
禁止新 Reserve/positive Root。

`research_budget_ledger_receipts` 保存 Derivation Wire §6 全部 `BudgetLedgerReceipt`
顶层列；`research_budget_ledger_input_bindings` 另存
ResearchBrief exact Ref、ordered Budget Event hash chain 与签发时 immutable
Reservation State projection。后者不能只从当前 mutable Reservation 重建历史
`input_hash`；三分支、parent/FK、cleanup 取 Physical Schema Descriptor §2。

`issue_research_budget_ledger_snapshot(jsonb)` 是唯一 public 签发口，exact Input/Result
取 Derivation Wire §6，仅接受 `RESEARCH_STOP_AUTHORITY`。锁
`Run→Brief→Policy Head/Version→Resource Head→Reservations→Budget Events`，以单一 DB
time 生成 Budget Receipt；`receipt_id=snapshot_operation_id`；
`snapshot_command_hash=research_kernel_sha256("u6-budget-ledger-snapshot-command@1",
strict IssueBudgetLedgerSnapshotInput)`。函数先按 operation/idempotency 查旧行：同 Hash
返回且不重取 DB time，异 Hash conflict；仅新 operation 取 `evaluated_at` 并生成
semantic input hash。固定 `U6_BUDGET_SNAPSHOT_MAX_AGE_MS=60000` 进入 Inventory/hash；若 snapshot
仍在 elapsed limit 内，`valid_until=min(evaluated_at+60000ms,budget deadline)`，若已经
EXHAUSTED 则为 `evaluated_at+60000ms`。

TS full verifier 不得把 `snapshot_command_hash` 当 opaque 字符串；须用 Receipt 的
Scope/Run、issuer principal、idempotency、receipt ID、ResearchBrief Ref 重建 strict
command 并按同 domain 重算。即使外层 Receipt Hash 同步重算，command hash 漂移仍失败。

事务锁定 exact current Brief、Policy Head/Version、Resource Budget Head，按事件 seq
重放，再按 `reservation_seq,reservation_id` 重验当前行。跳号、重复、锁后 Head 变化、
event after-vector 与当前 Reservation 不一致都失败。

`effective_limit[field]` 是 Runtime、current Tenant Policy、Brief 三者逐字段最小值。
`top_up_allowed` 仅来自 current Tenant Policy。Policy/Brief 只能收紧 Runtime；缺字段、
负数、超 safe integer 或 `max_source_calls != 0` 都失败。

C2a `top_up_allowed` 仅为“允许转入等待追加额度”信号，不实现额度变更。Tenant
Policy Head 更新必须推进 `POLICY` Frontier，不为所有 active Run 批量伪造 Budget Event；
run-specific Top-up command/event、上限方程与授权留到独立版本，未冻结前不得增加
`effective_limit`。

### 4.2 每个维度的唯一派生

```text
LedgerDimension =
  steps | model_calls | sql_executions | source_calls | elapsed_ms
  | provider_tokens | provider_cost_microusd

charged_used[d] = actual_used[d] + unresolved_hold[d]
charged_used[d] + remaining[d] = limit_axis(effective_limit,d) + overage[d]
remaining[d] >= 0 AND overage[d] >= 0
remaining[d] = 0 OR overage[d] = 0
```

`actual_used/unresolved_hold/charged_used` 用九字段 `ResearchBudgetUsage`，其中 input/output
tokens 是 `provider_tokens` 可审计分量；`remaining/overage` 用七字段
`ResearchBudgetBalance`。每个 Usage 都要求
`provider_tokens=provider_input_tokens+provider_output_tokens`。`limit_axis` 把七维分别
映射到 `max_steps/max_model_calls/max_sql_executions/max_source_calls/max_elapsed_ms/
max_provider_tokens_per_run/max_provider_cost_microusd_per_run`；per-call token 上限在每个
MODEL Reserve/Settle 验证，不是第八、九个 Run Balance 维度。

不得将实际超额 clamp 到 limit。现有 `ResearchBudgetLedgerBinding@1` 无法表示
`SETTLED_OVER_LIMIT`，所以 C2a 必须新增 `research-budget-ledger@2.0.0`，并让
Coverage/Stop v2 携带同一 Snapshot Binding 与 ledger projection；v1 只可历史读取，
不得进入正向 Root。

| 维度 | `actual_used` 与 `unresolved_hold` 的 DB 权威派生 |
| --- | --- |
| `steps` | 新增幂等 `STEP_BEGIN` event；DB 接受一个逻辑 step 即 actual `+1`，crash/retry 不回退；Reservation 不能代替 step |
| `model_calls` | MODEL 终态取 OutcomeUsage `actual.invocations`；`RESERVED|IN_USE|ABANDONED` hold `1` |
| `sql_executions` | SQL 终态取 OutcomeUsage `actual.executions`；未决状态 hold `1` |
| `source_calls` | U6 v1 actual/hold 均字面为 0；TOOL 是 `NON_SOURCE`，不得伪装 search |
| `elapsed_ms` | `floor(extract(epoch from evaluated_at-budget_started_at)*1000)` 的非负 DB 墙钟差；不信任 caller elapsed，也不把并行调用时长相加 |
| `provider_tokens` | MODEL 终态取 actual input+output；未决 MODEL hold reserved input+output |
| `provider_cost_microusd` | MODEL 终态取 committed OutcomeUsage actual；未决 MODEL hold reserved cost |

Provider cost 指受信 Adapter 提交的 usage cost，非 provider invoice；声称 billed cost
须另绑 immutable pricing/billing receipt。

状态固定：

- `RESERVED|IN_USE` 保留全部 hold；C2a Stop 一律拒绝仍在执行的工作；
- Invocation `OUTCOME_UNKNOWN` 与 Reservation `ABANDONED` 不释放 hold，直到 late terminal
  或受控 resolution；只允许导出带 `OUTCOME_RECONCILIATION_REQUIRED` 的
  `STOP_NEEDS_MORE_RESEARCH`，不得导出 PARTIAL/INCONCLUSIVE；
- `SETTLED|SETTLED_OVER_LIMIT` 释放 hold、记完整 actual 与 overage；
- pre-I/O `CANCELLED|EXPIRED` actual 为 0；post-I/O CANCELLED 只在 within-limit 时记
  committed actual，任一轴超额必须归 `SETTLED_OVER_LIMIT`；
- OutcomeUsage 已提交但 Reservation transition 未提交时仍保持 hold；actual/hold 切换与
  Resource Transition、Budget Event 必须同事务。

`ledger_hash=research_kernel_sha256("u6-research-budget-ledger@2", ledger without
ledger_hash)`；Receipt Hash 还覆盖 actual、hold、双水位、Policy、Brief、时间截面与
outstanding set。

### 4.3 v2 Artifact 无环生命周期

v2 delta/Registry 取 Derivation Wire。Artifact 绑定已提交 Budget Snapshot，不含未来
Receipt Ref；Root 只收两个 exact v2 Ref，唯一解析 Snapshot，新 Receipt 单向绑定 Artifact。
Terminal/Stop Commit 仅存 Stop Receipt ID/Hash；Stop Receipt 以 immediate FK 绑定
Candidate/Coverage/Budget，形成四链而不重复四组 FK。projection 不等只失败并要求新
revision；DB 不改旧 Artifact，也不收 inline Artifact/Receipt ID。

## 5. Coverage、Candidate 与 Stop Receipt

### 5.1 CoverageDerivationReceipt

`research_coverage_derivation_receipts` 保存 exact Coverage v2 Ref、EvidencePlan Ref、Budget
Receipt ID/Hash、五维 Frontier/Hash、规范排序的完整 OED/QueryEvidence/
Claim/Relation/Support/Assessment closure、`coverage_input_hash`、kernel version 与
Coverage payload hash；共同 `output_hash` 必须等于 `coverage_ref.content_hash`。

Root 要求 `RESEARCH_STOP_AUTHORITY`，重验 Coverage commit operation 的 exact
`RESEARCH_ARTIFACT_AUTHORITY(COVERAGE)` provenance；由 DB active pointer 枚举 Plan
完整闭包，不收 caller 子集，并重算：

- Plan obligation exact set、各 obligation 五态与 `derived_counts`；
- adverse Relation、unresolved Conflict、Support/Assessment 一一闭包；
- Budget Ledger 与 exact Budget Receipt 逐字相等；
- Frontier、Reference ordering、Coverage input/domain/envelope hash。

Scope/Run 校验须覆盖 Frontier 的 `semantic_release_ref`、
`schema_snapshot_ref` 与 `policy_receipt_ref`，不能只校验 Coverage 主闭包引用。

任一输入非 active exact revision、Budget Receipt 非 current、闭包多/少一项或 Coverage
Candidate 不等，均不写 Receipt。

Coverage v1 caller ledger 仅作历史输入；C2a Root 只收 `coverage-state@2.0.0`，其 Snapshot
Binding/v2 Ledger projection 须等于已提交 Budget Receipt；Stop v2 绑定同一 Snapshot。

### 5.2 CandidateEnumerationReceipt

SQL 不能推导 EIG、semantic admissibility 或 no-candidate reason。Provisioner 维护
immutable `research_enumerator_versions` 与 current Head，固定
`enumerator_version/eig_policy_version/input_schema_version/implementation_digest`。
server-only Enumerator 经 `issue_research_candidate_enumerator_attestation(jsonb)` 写
strict Attestation，绑定
exact Coverage v2、Budget input hash、current QueryContract universe、全部
Assessment/no-candidate closure、版本及 Root caller capability/epoch。表的 UQ
`(S,run_id,issuer_principal_id,idempotency_key)` 与 replay 规则取 Derivation Wire §4。

Attestation 与 Root 须用同一 principal/capability/epoch；Coverage 历史 operation 另证
`RESEARCH_ARTIFACT_AUTHORITY(COVERAGE)`。Root 不收 Attestation ID，从 Stop v2 candidate
projection 唯一锁定它，枚举 DB universe 并重算结构/hash/分支。DB 仅证明“版本化
Enumerator 声明 + exact replay”，不声称 SQL 重估 EIG；Agent mutation 无 exact
Attestation 即失败。
`enumerator_capability_id/authority_epoch` 必须等于共同 issuer，不得引入第二个
caller-selected Capability。

`research_candidate_enumeration_receipts` 使用
`candidate-enumeration-receipt@2.0.0`，保存 Coverage/Budget Receipt、
`enumerator_head_version`、`enumerator_version`、`eig_policy_version`、Enumerator
Authority capability/epoch、规范排序的 unresolved/no-candidate refs、逐 obligation
一一对应且带 reason/constraint closure/self-hash 的
`NoCandidateAssessment`、完整 Candidate Assessment、可形成 Candidate 的 current
QueryContract 宇宙及其 `enumeration_universe_hash`、现行 `candidate_set_hash` 与
Receipt Hash。Hash domain 升为 `u6-candidate-enumeration-receipt@2`；这是 strict Wire
breaking change，不得将新列塞入 v1 row。

`enumerator_head_version` 来自 Root 锁定的 current Head。首次冻结的 Candidate input
material 已含该字段且 input @1 domain 不改义；本切片将其加入 Receipt Wire v2、physical
row/self-hash 并同步 TS verifier。正式 `10600` row/PG17 parity 未实现。历史 replay 用
Receipt 自带 Head/Enumerator Version，Head 前进后仍可重算原 bytes，但不恢复 currentness。

Candidate full verifier 须同时取得 exact Attestation、Coverage、Budget Receipt；四者同
Scope/Run，Coverage 绑定同一 Budget。空 QueryContract universe 也不得掩盖
跨 Scope/Run 或预算换绑。

现行 `candidate_set_hash` 仍按 `u6-candidate-set@1` 重算
`{unresolved,candidateQueries,noCandidateRefs}`，不向旧域加版本。Receipt Hash 另绑
`enumerator_version`、`eig_policy_version`、完整 universe、规范排序的
`NoCandidateAssessment`；Attestation command/input/final Hash 与 Stop
`decision_input_hash` 也绑同一数组，Root 要求 Stop 两版本/candidate set 匹配 Receipt，
故 version swap 不可达。共同 `output_hash` 等于重算 `candidate_set_hash`。

完整性证明该 Enumerator 版本、current Coverage、已提交 QueryContract universe，非无限
自然语言查询空间的数学完备性。Enumerator 声明 obligation
`no_candidate` 须给冻结 reason/constraint closure；否则只能 `REPLAN` 或
`NEEDS_MORE_RESEARCH`，不能默认 INCONCLUSIVE。

### 5.3 ResearchStopDerivationReceipt

`research_stop_derivation_receipts` 保存 exact Stop/Coverage v2 Ref、Coverage/Candidate/
Budget Receipt ID/Hash、Support subset、required disclosures、pre-stop readiness
closure、kernel/enumerator/EIG policy version、决策分支与 `decision_input_hash`。

TS `verifyResearchStopDecisionV2` 先重验 Budget Receipt，再重算 Candidate 与
NoCandidate Assessment、兼容域 `candidate_set_hash` 和 `u6-stop-decision@1`。
`verifyDerivationReceipt` Stop full context 须递归验证 exact Candidate
Receipt/Attestation/Coverage/Budget，并闭合 Stop candidate projection、issuer、版本、
Supported Subset、decision、上游 Receipt identity/hash。即使修改
`constraint_closure_hash` 并重算 assessment、decision、Stop Ref/Input/Receipt 的全部
无密钥 Hash，只要 Candidate Receipt 未同步改变，full verifier 仍拒绝。Stop Ref Artifact
content hash 与 committed exact revision 仍由 Registry/DB resolver 证明，payload-only
verifier 不能冒充持久化 Authority。

签发函数要求 `RESEARCH_STOP_AUTHORITY`，重放 TypeScript 的互斥优先级：

```text
STOP_READY
> CONTINUE
> REPLAN
> STOP_NEEDS_MORE_RESEARCH
> STOP_PARTIAL
> STOP_INCONCLUSIVE
> no branch = reject
```

不得把未命中/tampered/stale 输入兜底为 PARTIAL。Candidate 按 EIG 降序，再按完整
QueryContract Ref identity 升序。共同 `output_hash` 等于 exact Stop Ref `content_hash`；
DB 还须独立重算并匹配 payload `decision_input_hash`，不能
混淆 Artifact content hash 与决策输入 hash。

C2a `commit_research_stop_terminal` 仅接受
`STOP_PARTIAL→PARTIAL`、`STOP_NEEDS_MORE_RESEARCH→NEEDS_MORE_RESEARCH`、
`STOP_INCONCLUSIVE→INCONCLUSIVE`；其余分支 typed refusal、零 terminal。Root command
只带 Stop/Coverage Ref，从两者解析同一 Snapshot；锁内要求 Budget
Event/Reservation/Policy/Brief 水位未变、`evaluated_at <= root_db_now <= valid_until`，
且两时点对 elapsed limit 同为 `IN_BUDGET` 或 `EXHAUSTED`。随后以同事务、Run lock、
DB-time 截面生成三张 Receipt/terminal；过龄、跨预算边界或水位变化均 stale，须重签
Snapshot 与 Artifact revision。

`research-stop@1.0.0` 仅供历史读取；C2a 只收 `research-stop@2.0.0`，其 Coverage v2、
Ledger、Candidate/EIG projection 须与本事务三张 Receipt/Snapshot 完整匹配。

## 6. Input Event Head 与 WatermarkReceipt

Input Event 是 Readiness 跨事务 currentness，非运行日志。新增：

```text
research_input_event_heads
  PK (S,run_id), next_event_seq, head_event_hash, updated_at

research_input_events
  PK (S,run_id,event_seq), event_kind, subject_identity, subject_hash,
  source_operation_kind, source_operation_id,
  previous_event_hash, event_hash, committed_at
  UQ (S,run_id,source_operation_kind,source_operation_id)

research_input_event_watermark_receipts
  protocol_version="research-input-watermark-receipt@1.0.0",
  common receipt columns, observed_event_seq, observed_head_hash,
  certificate_ref, certificate_input_closure_hash
```

Head 在 Run lock 下以 `next_event_seq=1` 与固定 genesis
`sha256:dd5957b6731ddebe575300e2448846e678030dfdc3c6e0bb1c95bce8b2a4944d`
（`SHA256(UTF8("u6-research-input-event-genesis@1.0.0"))`）建立；Receipt 观察值
`next_event_seq-1`。仅权威 current/状态变化时，source mutation 在同事务末尾 append；
相同 operation replay/no-op 不推进 seq：

1. `INPUT_ARTIFACT_CURRENT_CHANGED`：所有 current L2 Artifact，仅排除
   `ReportReadyCertificate`、`ReadinessRevocationReceipt`；CoverageState、
   ResearchStopDecision、Report Manifest/Report、Projection 与 Gate 也会推进水位；
2. `RESOURCE_LEDGER_CHANGED`：Budget Open/Step Begin/Reserve/Begin/Settle/Cancel/Expire/Abandon；
3. `VERSION_FRONTIER_CHANGED`：五维 Frontier Initialize/Advance。

通用 Repository 也能提交 L2 current Artifact，故不能依赖 TS repository，也不能让
UPDATE 后 trigger 反向补锁 Run。`10600` 必须撤销
Backend/`service_role` 的通用 Artifact DML；QueryContract 与全部 L2 写入统一走先锁
exact Run 的 owner security-definer committer，U6 reserved tuple 仍走专用 committer。
Trigger 仅在已持 Run 的函数内做 terminal/type 防御与 C2b Event append，不承担锁序
Authority；任一旁路存在时 Gate 失败，ACL/function/trigger/raw-DML 双连接反例进入
Inventory/Oracle。

`commit_artifact_revision_run_locked(jsonb)` 保留 `commitL2Artifact`、
`commitGroundingAuthorityArtifact`、model-certification worker 的 TS
strict/authority/secret/hash 语义，三分支 Input/Result 取 Derivation Wire §6。DB 再校验
Backend WRITE（Grounding 另需 OWNER）、`Run→Artifact`、parent CAS/input FK/terminal
absent、幂等写，并拒绝 reserved tuple。三 Adapter 只替换最终 DML，返回/错误不变。

append-only `research_backend_artifact_commit_operations`：PK `(S,operation_id)`，UQ
`(S,run_id,principal_id,idempotency_key)`，保存 mode/command hash、expected revision/
fence、`adopted_legacy`、exact committed Artifact Ref/DB time，FK 绑定 Run/Membership/
Artifact。ID/Hash 取 Derivation Wire §6。Run 锁后命中同 Hash 返回
`created=false`，异 Hash conflict。Operation 缺失但 exact Artifact 已存在时，函数锁行并
重验 canonical document/hash/parent/fence、分支 Authority/旧写入语义；相等则插入
`adopted_legacy=true` operation 并返回 false（Terminal 后也只许此 adoption），异值
conflict。两者均不存在才要求 terminal absent，原子写 Artifact 与
`adopted_legacy=false` operation，返回 true。Backend/worker 无表 DML；Cleanup 先删
Operation 后删 Artifact。

`ReportReadyCertificate` 与 `ReadinessRevocationReceipt` 不追加 Input Event，避免自身
commit 后立即 stale；Coverage/Stop 是 Certificate current 输入，须
进入事件流。Membership/Capability 在 Publish/Consume 事务中直接锁行重验；会改变研究
语义的 Policy/Identity 变化还必须推进对应 Frontier。

```text
event_hash = u6_domain_sha256(
  "u6-research-input-event@1.0.0",
  {run_id,event_seq,event_kind,subject_identity,subject_hash,
   source_operation_kind,source_operation_id,previous_event_hash}
)
```

Event Hash 是 DB-only append-chain authority，不冒充跨运行时 Research semantic hash。
Watermark Receipt 要求 Certificate
`evaluated_through_input_event_seq == observed_event_seq`，并绑定同一
`certificate_input_closure_hash`。未来 Publish/Consume 须锁 current Head 并比较
seq/hash；任一新 input event 令旧 Certificate stale。只比较 caller seq、自哈希或
Checkpoint 值无效。

C2a 不依赖 Input Event Head：Stop Root/source writer 由 exact Run lock 串行；Root 同事务
重验 Artifact、Budget/Policy/Resource/Event/Reservation，生成三张 Receipt 后写吸收态
non-ready terminal，currentness 不跨事务悬空且 Publish 永久不可达。C2b
Certificate/Publish/Consume 跨事务，才引入 Event Head/Watermark 与 ReportReady Receipt；
未冻结/实现前两个 Root 保持 fail closed。

## 7. FK 与 Cleanup 子图

`10600` immediate exact FK：

```text
DomainTerminal / StopCommit → StopDerivationReceipt
StopDerivationReceipt → CandidateReceipt, CoverageReceipt, BudgetReceipt
CandidateReceipt → EnumeratorAttestation, CoverageReceipt, BudgetReceipt
CoverageReceipt → BudgetReceipt
WatermarkReceipt → InputEventHead, exact Certificate artifact
BudgetReceipt → BudgetPolicyVersion, ResourceHead
BudgetEvent → ResourceHead, optional Reservation, optional StepOperation
EnumeratorAttestation → EnumeratorVersion
BudgetPolicyHead → BudgetPolicyVersion
EnumeratorVersionHead → EnumeratorVersion
InputEvent → InputEventHead
```

mutable Head FK 只引用稳定 PK，snapshot 由 owner 锁行重验；否则历史行阻断 CAS。
`STEP_BEGIN` 只保留 `BudgetEvent→Step`；反向 immediate FK 会形成插入环。

`10600` pre-DDL 先断言 StopCommit 与 RESEARCH_STOP non-ready DomainTerminal 均为零，
禁止合成历史 Receipt；既有 READY/STALE 保留且新列为 NULL。随后两表增加
`stop_derivation_receipt_id uuid/hash text`：StopCommit 两列 NOT NULL；DomainTerminal
仅 RESEARCH_STOP 的 PARTIAL/NEEDS_MORE_RESEARCH/INCONCLUSIVE 要求两列非空，其余为
NULL。两表均以 `(S,run_id,id,hash)` immediate FK 到 Stop Receipt exact UQ；Root 重算
Hash，断言两组列相等，禁止只存 ID/caller Hash。

全部展开 `S/run` candidate key，禁止 JSON/hash 冒充 FK。variable Ref companion 先以
parent exact FK，再以展开 Reference exact FK 到 Artifact；strict Ref JSON 仅作 replay
projection。Cleanup 须 child-first：
StopCommit → Terminal → Stop/Candidate/Coverage companion →
Stop → Candidate → Attestation companion → Attestation → Coverage →
ArtifactCommitOperation → Budget input binding → Budget/Watermark → Input Event/Head；
Resource 侧 Budget Event → Transition → Reservation → Step → Head；
最后删 current Head+bound Policy/Enumerator Version。唯一 phase/closed set 取 Cleanup
分册；`10600` 表不得逃逸 residual。

## 8. C2 锁 rank 与 currentness

唯一全局锁序取 Database Surface §3，不建第二张 rank 表。C2 插入位置固定：
Artifact 后锁 `Budget Policy→Resource Head→Reservation→Budget Event`，再进入
Readiness/Frontier/Terminal；业务锁后锁 Input Event Head，最后锁 Receipt semantic/
idempotency key。逐行 `FOR UPDATE NOWAIT`，禁止 join lock。

所有入口先锁 Run，故 Resource writer `Run→Brief→Budget Head→Reservation`、普通 Artifact
writer `Run→Artifact`、首 Brief writer `Run→Artifact→Head→Event` 与 Root 无反向环。
Input Event Head 位于业务锁后，不存在 Head→Run/Artifact/Reservation 入口；Receipt 锁后不得
回到 Artifact/Resource/Frontier。

当前 Stop/Publish latent SQL 锁序不符，不能删除早期 `return` 启用；C2a 须按上述顺序
重写 Stop，Publish/Consume 固定拒绝。Artifact committer 须在 Artifact 前取 Relation Pair
lock，不得先写 Artifact 再反向取 Pair。
C2a 先持有 Terminal absent-key advisory/已有行锁，再锁已绑定 Budget Snapshot、插入三张
新 Receipt，最后 INSERT Terminal；最后一步不取新 lock rank。Receipt semantic/idempotency
absent key 也须先
advisory，避免并发不存在行穿透。

non-ready Terminal 是吸收态。Step/Reserve/Begin/Start、新 Artifact/Frontier、Budget
Snapshot/Enumerator Attestation writer 锁 Run 后均重验 Terminal absent；Stop 胜出后仅
replay 此前 exact operation，不得新签发。只许已发生 I/O 的 late terminal、
Settle/Cancel/Abandon 对账及 Retention/Cleanup 继续；不得创建新 Invocation/Artifact、
改变 Terminal 或重签 Stop Receipt。`10600` 须将 guard 加入全部 Resource/Invocation RPC，
不能只保护 Artifact committer。

C2a Root 在写 terminal 前必须一次性满足：

- caller capability、Receipt issuer capability 均 active、未过期、epoch/principal exact；
- Stop/Coverage 与 Receipt 中全部 Reference 为同 Scope/Run 且仍是 active exact revision；
- Budget Snapshot 未过 60 秒、Policy/Brief 与 Reservation/Budget Event 双水位未变，
  outstanding set、Budget Ledger 与五维 Frontier exact；
- Enumerator Head/exact Version 与唯一 Attestation 仍 current，且 issuer
  principal/capability/epoch 等于 Root caller；
- 不存在 `RESERVED|IN_USE`；若存在 `ABANDONED|OUTCOME_UNKNOWN`，decision 必须是带固定
  reconciliation code 的 `STOP_NEEDS_MORE_RESEARCH`；
- Stop/Coverage/Receipt chain、decision、reason/disclosures 与所有 Hash exact；
- CurrentReadiness 不存在，Domain Terminal 不存在；
- terminal 与 decision 为固定三种映射。

任何失败均在 terminal INSERT 前。同一 semantic input 并发仅一个 Receipt/Terminal；
loser 只能 exact replay 同结果或得 typed conflict，不得产生第二次可见副作用。

## 9. PostgreSQL 17 Oracle 与交付分段

### 9.1 C2a 必过

1. **Parity**：全部 golden/reject vector 通过 TS/PG17；旧 DB hash 不改义。
2. **正路径**：PARTIAL、NEEDS_MORE_RESEARCH、INCONCLUSIVE 各提交一次 exact Receipt
   chain/唯一 terminal；同键 replay 返回同一持久结果。
3. **Mutation**：改 decision/version/universe/EIG/Budget/Policy/Coverage/disclosure/
   Ref hash、`enumerator_head_version` 或 companion ordinal/path，均在 terminal 前失败。
4. **Authority mutation**：expired/revoked capability、epoch/principal/scope/run 换绑、
   historical revision、cross-run Receipt 全失败。
5. **并发**：Stop 对 Stop/Reserve/Artifact/Frontier 仅一 winner、无死锁；Stop 胜出后
   新 Step/Reserve/Begin/Start/Snapshot/Attestation 零写，旧 replay/late 对账可返回。
6. **Budget**：step、pre-I/O cancel/expire、failed I/O、over-limit、DB wall-clock、
   active 与 ABANDONED fixtures 逐字段重算；RESERVED/IN_USE 拒绝，ABANDONED 只能进入
   NEEDS_MORE_RESEARCH。
   `ENCRYPTED_RESULT_TERMINAL` 成功 OutcomeUsage 未可提交时不得伪造 actual，也不得开放
   依赖该 actual 的 Stop fixture。
7. **Bypass**：Backend/service/Browser 无表 DML/internal EXECUTE；额外 GRANT/直写被
   Inventory 杀死。
8. **边界**：C2a 后 Publish/Consume 仍返回
   `RESEARCH_DATABASE_AUTHORITY_REQUIRED`；non-ready terminal 后 Publish 永久失败。
9. **物理闭包**：15 core semantic tables 与 15 source segments 独立验证，新增 relation
   exact 为 20；少任一 companion、JSON/展开列/FK 不一致或 historical replay 依赖当前
   Reservation/Enumerator Head 均失败。

### 9.2 C2b 之后才可开放

Input Event append/head、Watermark/ReportReady Derivation Receipt、source allowlist
mutation、head advance stale、Publish/Consume/Revocation concurrency、Hosted
Supabase/Docker 双连接 parity 全通过后，才可移除 Publish/Consume 固定拒绝；缺一只能报告
`PARTIAL_IMPLEMENTATION`。

每阶段独立提交：合同/研究→Migration/TS/Adapter→PG17→Hosted/Docker；Codex 阻断项在
同阶段修复。合成 Fixture 不得冒充业务/Release 证据。
