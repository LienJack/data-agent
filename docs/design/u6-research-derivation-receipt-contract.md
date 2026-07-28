# U6 Research 派生回执与输入水位合同

> `FROZEN_DESIGN_CONTRACT / NOT_IMPLEMENTED` ·
> `u6-research-derivation-receipt@1.0.0`
>
> 本文唯一拥有五类 Receipt 的表、事务、锁与 currentness；它们的 exact Hash/v2 Wire 取
> `u6-research-derivation-wire-contract.md`，业务 v1 Wire 取
> `u6-research-wire-payload-contract.md`，事务结果与错误取
> `u6-research-platform-contract.md`，SQL 暴露面、Owner、RLS、GRANT 与 Inventory 取
> `u6-research-database-surface-contract.md`。
>
> 源码审计固定 `data-agent@6f2836c1d05f14d5f70490524afe12a157784596`。
> 该版本三个 Readiness Root 仍固定 fail closed；本文冻结的是 C2 目标合同，不是生产完成
> 证据。

## 1. 问题、范围与不变量

当前 TypeScript Research Kernel 使用
`SHA256(UTF8(canonicalizeJson({hash_domain,value})))`，而 PostgreSQL
`u6_domain_sha256` 使用 `domain || NUL || canonical payload`。此外，当前
`CoverageState.budget_ledger` 只有结构与算术校验，Candidate Set Hash 不绑定
`enumerator_version`，Certificate 的 `evaluated_through_input_event_seq` 也没有数据库
Event Head。删除 Root 中的固定拒绝会把 caller 自报 JSON 升级为不可变领域终态。

本文固定五条不变量：

1. Agent、Mastra Workflow、API、Checkpoint、Redis 与进程内 brand 都不是派生真值；
2. TypeScript 与 PostgreSQL 对 Research Hash 必须消费相同 UTF-8 bytes，并共享 golden
   vector；
3. Receipt 由数据库持久化、约束、排序、重算和控制 currentness；调用方不能直接
   INSERT/UPDATE/DELETE，也不能选择一个较有利的历史 Receipt；
4. C2a 只开放 `PARTIAL|NEEDS_MORE_RESEARCH|INCONCLUSIVE`。`STOP_READY`、Publish 与
   Consume 不因 C2a 可达；
5. 设计、Synthetic Oracle、PostgreSQL 实现与真实业务证据分层报告。本文通过不代表
   Migration、Hosted/Docker 或产品演示通过。

## 2. Hash 与 v2 Wire 路由

跨运行时值域、golden/reject vector、拒重 Reference 顺序、Coverage/Stop v2 exact
Schema、Enumerator Attestation 与逐 kind hash domain 只取
`u6-research-derivation-wire-contract.md`；本文不复制第二份 codec。

## 3. DB-owned Receipt 共同包络

五类表都展开 `S=(app_id,tenant_id,environment)`；共同包络与各 kind strict object 只取
Derivation Wire §6，数据库列不得省略、改名或接受额外字段。

共同关系合同：

- PK 为 `(S,receipt_id)`；UQ 为
  `(S,run_id,issuer_principal_id,idempotency_key)`，并提供 exact FK target
  `(S,run_id,receipt_id,receipt_hash)`；
- 每张 kind table 另有 semantic UQ
  `(S,run_id,protocol_version,input_hash)`；同一版本和输入只能产生一个输出，不能用
  `(input_hash,output_hash)` 放行两个不同输出；
- FK exact Run、retained Membership，以及
  `(S,issuer_capability_id,issuer_authority_epoch,issuer_principal_id)`；
- Reference 既保存 strict `jsonb` 投影，也保存规范 identity/类型/revision/content hash
  列并建立 exact FK；JSON 不能是唯一完整性来源；
- `committed_at` 的 hash material 是数据库生成并原样返回的 UTC RFC3339 字符串，固定六位
  小数；`receipt_hash=research_kernel_sha256(receipt domain, all common and kind fields
  except receipt_hash)`；
- 同键同 input 返回已持久结果，同键异 input 返回
  `RESEARCH_DERIVATION_RECEIPT_CONFLICT`；事务失败零 Receipt；
- Receipt 只 append。普通 RPC 无 UPDATE/DELETE；Lifecycle Cleanup 仍按 U6 Cleanup
  Inventory 删除整个 Scope，不把业务可变性引入 Receipt；
- Budget Snapshot 由专用 RPC 先签发；Root 不接受独立 caller receipt selector，而从
  exact current Stop/Coverage 中取得同一 Binding。其余 Receipt 由 Root 唯一生成；缺失、
  多候选或 current mismatch 都拒绝。

唯一 SQL owner 是 `data_agent_u6_data_owner`，唯一写入口由
`data_agent_u6_rpc_owner` 的 `SECURITY DEFINER SET search_path=''` 函数持有。
普通 Backend、`service_role`、Browser、Agent 与 Job 都没有表 DML；internal hash/resolve
helper 也不向它们 GRANT EXECUTE。所有表 `ENABLE + FORCE RLS`，策略只允许 exact Owner
Scope；RLS 不代替 FK、CHECK 或函数内 Authority。

语义派生仍由版本化 deterministic Research Kernel/Enumerator 完成；数据库负责重放
canonical bytes、strict schema、引用闭包、cross-field equation、decision branch、
Authority provenance 与 currentness。统计 EIG 等无法由 SQL 从原始数据重新估计的值，必须
来自隔离的 `RESEARCH_STOP_AUTHORITY` Enumerator，并由 Candidate Receipt 固定版本和完整
输入宇宙；Agent 自报值无效。

## 4. BudgetLedgerReceipt

### 4.1 权威输入、事件水位与表

新增 immutable `research_budget_policy_versions` 与 current
`research_budget_policy_heads`。每个 Scope 必须由 Provisioner 显式安装 policy；
缺 Head 不使用隐式默认值。Policy 固定 `limits`、`top_up_allowed`、version/hash。

仅有 `reservation_seq` 不足以形成账本水位：旧 Reservation 的 Begin/Settle/Cancel/
Expire/Abandon 会改变用量，却不推进 `next_reservation_seq`。因此扩展
`research_resource_run_heads`：

```text
next_budget_event_seq bigint >= 1
next_step_seq bigint >= 1
budget_epoch bigint >= 0
budget_epoch_state ACTIVE | LEGACY_BUDGET_EPOCH_UNPROVABLE
budget_started_at timestamptz|null
last_budget_event_hash Sha256|null
```

`ACTIVE` 当且仅当 `budget_epoch>=1`、time/hash 非空；legacy 当且仅当 epoch=0、time/hash
为空，任何 Receipt/positive Root 都拒绝 legacy。`10600` 把迁移开始时所有 existing Run
分类为 legacy：已有 Head 原位标记，无 Head 则插入 seq=1 的 legacy Head；不猜历史开始
时间。只有迁移后创建的新 Run 可由首个 current `ResearchBrief@2` 初始化 active epoch。

并新增 append-only `research_budget_events`。`BUDGET_OPENED` 以及每个
Reserve/Begin/Settle/Cancel/Expire/Abandon/`STEP_BEGIN` 都必须与原业务 mutation 在同一
事务追加事件；
UQ `(S,run_id,source_operation_kind,source_operation_id)` 使重放不推进 seq。事件保存
reservation/step identity、actual/hold before-after、uncertainty before-after、
previous/event hash 与 DB time。Receipt 同时绑定：

- `evaluated_through_reservation_seq=next_reservation_seq-1`；
- `evaluated_through_budget_event_seq=next_budget_event_seq-1`；
- `evaluated_at` 与 `budget_started_at`；
- exact Brief、Runtime limit、Tenant Policy；
- active/outcome-unknown/abandoned exact set hash。

Head 不再由首次 Reserve 懒创建。第一个 current `ResearchBrief@2` 提交事务在锁住 Run 后
创建 `budget_epoch=1`、`budget_started_at=transaction_timestamp()` 的 Head 与
`BUDGET_OPENED` genesis event；无 Reservation 的 Stop 因而仍有 DB 时间起点。C2 migration
前已有 Head/Reservation 的 Run 标为 `LEGACY_BUDGET_EPOCH_UNPROVABLE`，不得回填猜测时间并
进入正向 Root；它必须新建 Run。

`begin_research_step(jsonb)` 的 exact Input/Result 取 Derivation Wire §6；它要求 active
Attempt/Fence，UQ `(S,run_id,logical_step_id)` 与
`(S,run_id,principal_id,idempotency_key)`；同 logical ID 同 input replay 不计第二次，
异 input 冲突。它在 `Run→Outbox→Attempt→Resource Head` 后追加 `STEP_BEGIN`，实际
`steps+1`。每次 MODEL/SQL Reserve 必须绑定已提交的 `logical_step_id`；retry 复用 step，
fork/new logical work 使用新 ID，Agent 内存计数没有 Authority。

`research_step_operations` 固定：PK `(S,step_operation_id)`；UQ
`(S,run_id,budget_epoch,logical_step_id)` 与
`(S,run_id,principal_id,idempotency_key)`；保存独立 `step_seq`、kind/input hash、
parent logical ID、Outbox/Attempt/Fence、Budget Event seq/Hash 与 DB time。Head 锁内分别
分配并推进 `next_step_seq`、`next_budget_event_seq`，两者不要求相等；parent nullable
self-FK、Attempt exact composite FK 都 immediate，且 parent 必须同 epoch 并满足
`parent.step_seq < child.step_seq`。`10600` 给 Reservation 增加
`budget_epoch`（legacy=0）与 `logical_step_id`：active epoch 的 MODEL/SQL 必须非空并以
`(S,run,epoch,logical_step_id)` exact FK 到 Step；TOOL 可空，legacy 行可空但 legacy Head
禁止任何新 Reserve/positive Root。

`research_budget_ledger_receipts` 保存 Derivation Wire §6 的全部
`BudgetLedgerReceipt` 列。

`issue_research_budget_ledger_snapshot(jsonb)` 是唯一 public 签发口，exact Input/Result
取 Derivation Wire §6，只接受 `RESEARCH_STOP_AUTHORITY`。它锁
`Run→Brief→Policy Head/Version→Resource Head→Reservations→Budget Events`，以单一 DB
time 生成 Budget Receipt。`receipt_id=snapshot_operation_id`；
`snapshot_command_hash=research_kernel_sha256("u6-budget-ledger-snapshot-command@1",
strict IssueBudgetLedgerSnapshotInput)`。函数先按 operation/idempotency 查旧行：Hash 相同
直接返回，不重取 DB time；不同则 conflict。仅新 operation 才取 `evaluated_at` 并生成
semantic input hash。固定 `U6_BUDGET_SNAPSHOT_MAX_AGE_MS=60000` 进入 Inventory/hash；若 snapshot
仍在 elapsed limit 内，`valid_until=min(evaluated_at+60000ms,budget deadline)`，若已经
EXHAUSTED 则为 `evaluated_at+60000ms`。

事务锁定 exact current Brief、Policy Head/Version、Resource Budget Head，并按事件 seq
重放，再按 `reservation_seq,reservation_id` 重验当前行。跳号、重复、Head 在锁后变化、
event after-vector 与当前 Reservation 不一致都失败。

`effective_limit[field]` 是 Runtime、current Tenant Policy、Brief 三者逐字段最小值。
`top_up_allowed` 只来自 current Tenant Policy。Policy/Brief 只能收紧 Runtime；缺字段、
负数、超 safe integer 或 `max_source_calls != 0` 都失败。

C2a 的 `top_up_allowed` 只是“允许转入等待追加额度”的决策信号，不实现额度变更。Tenant
Policy Head 更新必须推进 `POLICY` Frontier，不为所有 active Run 批量伪造 Budget Event；
真正的 run-specific Top-up command/event、上限方程与授权留到独立版本，未冻结前不得增加
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

`actual_used/unresolved_hold/charged_used` 使用九字段 `ResearchBudgetUsage`，其中 input/output
tokens 是 `provider_tokens` 的可审计分量；`remaining/overage` 使用七字段
`ResearchBudgetBalance`。每个 Usage 都要求
`provider_tokens=provider_input_tokens+provider_output_tokens`。`limit_axis` 把七维分别
映射到 `max_steps/max_model_calls/max_sql_executions/max_source_calls/max_elapsed_ms/
max_provider_tokens_per_run/max_provider_cost_microusd_per_run`；per-call token 上限在每个
MODEL Reserve/Settle 上验证，不是第八、九个 Run Balance 维度。

不得把实际超额 clamp 到 limit。现有 `ResearchBudgetLedgerBinding@1` 无法表示
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

Provider cost 的含义是“受信 Adapter 提交的 usage cost”，不是 provider invoice；若未来要
声称 billed cost，必须另绑 immutable pricing/billing receipt。

状态固定：

- `RESERVED|IN_USE` 保留全部 hold；C2a Stop 一律拒绝仍在执行的工作；
- Invocation `OUTCOME_UNKNOWN` 与 Reservation `ABANDONED` 不释放 hold，直到 late terminal
  或受控 resolution；只允许导出带 `OUTCOME_RECONCILIATION_REQUIRED` 的
  `STOP_NEEDS_MORE_RESEARCH`，不得导出 PARTIAL/INCONCLUSIVE；
- `SETTLED|SETTLED_OVER_LIMIT` 释放 hold、记完整 actual 与 overage；
- pre-I/O `CANCELLED|EXPIRED` actual 为 0；post-I/O CANCELLED 记 committed actual；
- OutcomeUsage 已提交但 Reservation transition 未提交时仍保持 hold；actual/hold 切换与
  Resource Transition、Budget Event 必须同事务。

`ledger_hash=research_kernel_sha256("u6-research-budget-ledger@2", ledger without
ledger_hash)`；Receipt Hash 还覆盖 actual、hold、双水位、Policy、Brief、时间截面与
outstanding set。

### 4.3 v2 Artifact 无环生命周期

v2 exact delta 与 Registry 取 Derivation Wire。Artifact 绑定已提交 Budget Snapshot，
不含未来 Receipt Ref；Root 只收两个 exact v2 Ref，从中唯一解析 Snapshot，并让新 Receipt
单向绑定 Artifact。Terminal/Stop Commit 只
直接保存 Stop Receipt ID/Hash，Stop Receipt 再以 immediate FK 绑定 Candidate/Coverage/
Budget 三张，形成可追溯四链而不重复四组外键。projection 不等时只失败并要求新 revision，
DB 不修改旧 Artifact，也不接受 inline Artifact/Receipt ID。

## 5. Coverage、Candidate 与 Stop Receipt

### 5.1 CoverageDerivationReceipt

`research_coverage_derivation_receipts` 保存 exact Coverage v2 `coverage_ref`、EvidencePlan Ref、
Budget Receipt ID/Hash、五维 Frontier/Hash、按规范顺序的完整 OED/QueryEvidence/
Claim/Relation/Support/Assessment closure、`coverage_input_hash`、kernel version 与
Coverage payload hash；共同 `output_hash` 必须等于 `coverage_ref.content_hash`。

Root 要求 `RESEARCH_STOP_AUTHORITY`，并重验 Coverage Artifact commit operation 中的
exact `RESEARCH_ARTIFACT_AUTHORITY(COVERAGE)` provenance；它从数据库 active pointer
枚举 Plan 完整闭包，不接受 caller 选择子集，并重算：

- Plan obligation exact set、各 obligation 五态与 `derived_counts`；
- adverse Relation、unresolved Conflict、Support/Assessment 一一闭包；
- Budget Ledger 与 exact Budget Receipt 逐字相等；
- Frontier、Reference ordering、Coverage input/domain/envelope hash。

任一输入不是 active exact revision、Budget Receipt 不 current、闭包多/少一项或 Coverage
Candidate 不逐字相等，都不写 Receipt。

Coverage v1 内联的 caller ledger 只作历史输入；C2a Root 只接受
`coverage-state@2.0.0`，其 Snapshot Binding 与 v2 Ledger projection必须逐字等于已提交
Budget Receipt；Stop v2 必须绑定同一 Snapshot。

### 5.2 CandidateEnumerationReceipt

统计 EIG、semantic admissibility 与 no-candidate reason 不能从现有 QueryContract 由 SQL
凭空推导。Provisioner 因此维护 immutable `research_enumerator_versions` 与 current
Head，固定 `enumerator_version/eig_policy_version/input_schema_version/
implementation_digest`。server-only Enumerator 先经
`issue_research_candidate_enumerator_attestation(jsonb)` 写 immutable strict
`candidate-enumerator-attestation@1.0.0`：它绑定 exact Coverage v2、Budget input hash、
完整 current QueryContract universe、每项 Assessment/no-candidate closure、两个版本及
调用者 `RESEARCH_STOP_AUTHORITY` capability/epoch。
表另有 UQ `(S,run_id,issuer_principal_id,idempotency_key)`；ID/command Hash replay 规则
取 Derivation Wire §4。

该窄入口和随后 Root 必须使用同一 principal/capability/epoch；Root 不再锁第二套
Coverage/Enumerator capability bundle。Coverage Artifact 的历史 commit operation 另行
证明它当时由 `RESEARCH_ARTIFACT_AUTHORITY(COVERAGE)` 提交；Coverage Receipt 的 issuer
仍是当前 Root 的 Stop Authority。Root 不接收 Attestation ID，而是从 Stop v2 的完整
candidate projection 唯一定位并锁定 exact Attestation，再枚举数据库 QueryContract
universe、重算所有结构/hash/分支。由此 DB 证明的是“受控 Enumerator 对完整输入的版本化
声明 + DB exact replay”，不是 SQL 自己重新估计统计 EIG；Agent 自报或任一字段 mutation
因找不到 exact Attestation 而失败。

Receipt 的 `enumerator_capability_id/authority_epoch` 必须逐字等于共同 issuer 字段；不得
借 Attestation 引入第二个 caller-selected Capability。

`research_candidate_enumeration_receipts` 保存 Coverage Receipt、Budget Receipt、
`enumerator_version`、`eig_policy_version`、Enumerator Authority capability/epoch、
规范排序的 unresolved/no-candidate refs、完整 Candidate Assessment、可形成 Candidate
的 current QueryContract 宇宙及其 `enumeration_universe_hash`、现行
`candidate_set_hash` 与 Receipt Hash。

现行 Wire `candidate_set_hash` 继续按 `u6-candidate-set@1` 重算
`{unresolved,candidateQueries,noCandidateRefs}`；版本不被偷偷加入旧 hash domain。
Receipt Hash 必须额外绑定 `enumerator_version`、`eig_policy_version` 与完整 universe，
Root 又要求 Stop 的两个版本和 candidate set 逐字匹配该 Receipt，因此 version swap 不可达。
该 kind 的共同 `output_hash` 等于已重算的 `candidate_set_hash`。

完整性是“对该 Enumerator 版本、当前 Coverage、已提交 QueryContract universe”的证明，
不是对无限自然语言查询空间的数学完备声明。Enumerator 若要声明某 obligation
`no_candidate`，必须给出冻结 reason/constraint closure；否则只能 `REPLAN` 或
`NEEDS_MORE_RESEARCH`，不能默认 INCONCLUSIVE。

### 5.3 ResearchStopDerivationReceipt

`research_stop_derivation_receipts` 保存 exact Stop v2/Coverage v2 Ref、Coverage/Candidate/
Budget Receipt ID 与 Hash、Support subset、required disclosures、pre-stop readiness
closure、kernel/enumerator/EIG policy version、决策分支与 `decision_input_hash`。

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

它不得把未命中、tampered 或 stale 输入兜底成 PARTIAL。Candidate 排序固定 EIG 降序，
再按完整 QueryContract Ref identity 升序。共同 `output_hash` 必须等于 exact Stop Ref 的
`content_hash`；数据库还须独立重算 payload 的 `decision_input_hash` 并逐字匹配，不能
混淆 Artifact content hash 与决策输入 hash。

C2a `commit_research_stop_terminal` 只接受 Receipt decision：

- `STOP_PARTIAL → PARTIAL`；
- `STOP_NEEDS_MORE_RESEARCH → NEEDS_MORE_RESEARCH`；
- `STOP_INCONCLUSIVE → INCONCLUSIVE`。

`STOP_READY|CONTINUE|REPLAN` 均返回 typed refusal 且零 terminal。Root command 仍只携带
Stop/Coverage Ref，不增加 caller selector。它从两者解析同一 Budget Snapshot，要求锁内
Budget Event/Reservation/Policy/Brief 水位未变，且
`evaluated_at <= root_db_now <= valid_until`，并且 `root_db_now` 与 `evaluated_at` 对
elapsed limit 同为 `IN_BUDGET` 或同为 `EXHAUSTED`。随后在同一事务、Run lock 与 root DB
time 截面生成 Coverage/Candidate/Stop 三张 Receipt；过龄、跨预算边界或任一水位变化返回
stale，须重新签发 Snapshot 与 Artifact revision。

现有 `research-stop@1.0.0` 只可历史读取；C2a Root 只接受
`research-stop@2.0.0`，并要求其 Coverage v2、Ledger、Candidate/EIG projection 与本事务
三张新 Receipt及已绑定 Budget Snapshot 完整匹配。

## 6. Input Event Head 与 WatermarkReceipt

Input Event 是 Readiness 的跨事务 currentness，不是运行日志。新增：

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
（`SHA256(UTF8("u6-research-input-event-genesis@1.0.0"))`）建立；Receipt 观察值为
`next_event_seq-1`。只有权威 current/状态确实变化时，source mutation 才在同一事务最后
append；相同 operation replay 或 no-op 不推进 seq：

1. `INPUT_ARTIFACT_CURRENT_CHANGED`：所有 current L2 Artifact，唯一排除
   `ReportReadyCertificate` 与 `ReadinessRevocationReceipt`；因此 CoverageState、
   ResearchStopDecision、Report Manifest/Report、Projection 与 Gate 也会推进水位；
2. `RESOURCE_LEDGER_CHANGED`：Budget Open/Step Begin/Reserve/Begin/Settle/Cancel/Expire/Abandon；
3. `VERSION_FRONTIER_CHANGED`：五维 Frontier Initialize/Advance。

通用 Repository 也能提交部分 L2 current Artifact；实现必须用受控 DB trigger，或把全部
readiness-affecting commit 收敛到同一专用函数。只改
`commit_current_l2_artifact` 而允许另一入口绕过 Event Head，Gate 固定失败。

C2a 不能只依赖 TypeScript repository，也不能让 row trigger 在 UPDATE 已锁 Artifact 后再
反向补锁 Run。`10600` 必须撤销 Backend/`service_role` 对 `artifacts` 的通用
INSERT/UPDATE；QueryContract 与全部 L2 写入改走先锁 exact Run 的 owner
security-definer committer，U6 reserved tuple 仍走专用 committer。Trigger 只在这些已持
Run 的函数内做 terminal/type 防御和 C2b Event append，绝不是锁序 Authority。ACL、
function allowlist、trigger definition 与 raw DML 两连接反例进入 Inventory/Oracle；通用
DML 未撤销时 Stop Root 继续固定 fail closed。

`commit_artifact_revision_run_locked(jsonb)` 保持现有 `commitL2Artifact` 与
`commitGroundingAuthorityArtifact`，以及 worker
`createPostgresModelCertificationReceiptStore.commit` 的 TypeScript
strict/authority/secret/hash characterization；exact 三分支 Input/Result 取 Derivation
Wire §6。DB 再执行 current Backend WRITE（Grounding 还要求 OWNER）、
`Run→Artifact`、parent CAS/input FK/terminal absent 与幂等写。它拒绝 U6 reserved tuple，
后者仍只走 `commit_current_l2_artifact`。三个现有 Adapter 只替换最终 DML，返回与错误不变。

新增 append-only `research_backend_artifact_commit_operations`：PK `(S,operation_id)`，
UQ `(S,run_id,principal_id,idempotency_key)`，保存 mode/command hash、expected revision/
fence、`adopted_legacy`、exact committed Artifact Ref/DB time，并以 FK 绑定 Run/
Membership/Artifact。ID/Hash 取 Derivation Wire §6。Run 锁后命中同 Hash返回
`created=false`，异 Hash conflict。Operation 缺失但 exact Artifact 已存在时，函数锁行并
重验 canonical document/hash/parent/fence、分支 Authority 与旧写入语义；逐字相等则插入
`adopted_legacy=true` operation 后返回 false（Terminal 后也仅允许此 adoption），异值
conflict。两者都不存在才要求 terminal absent，原子写 Artifact +
`adopted_legacy=false` operation 并返回 true。Backend/worker 无表 DML，Cleanup 先删
Operation 再删 Artifact。

`ReportReadyCertificate` 与 `ReadinessRevocationReceipt` 不追加 Input Event，避免
Certificate commit 使自身立即 stale；Coverage/Stop 是 Certificate 的 current 输入，必须
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
Watermark Receipt 要求 Certificate 的
`evaluated_through_input_event_seq == observed_event_seq`，并绑定同一
`certificate_input_closure_hash`。未来 Publish/Consume 必须锁 current Head 并同时比较
seq/hash；任一新 input event 令旧 Certificate stale。只比较 caller seq、自哈希或
Checkpoint 值无效。

C2a 不依赖 Input Event Head：Stop Root 与所有 U6 source writer 都先锁 exact Run；Root
在同一事务内再锁并重验 active Artifact、Budget Snapshot/Policy、Resource/Budget Head、
事件与 Reservation，生成三张新 Receipt，最后写吸收态 non-ready terminal。因 Run 串行化且
non-ready terminal 永久禁止 Publish，当前性不跨事务悬空。C2b 的 Certificate 派生、
Publish 与 Consume 分处不同事务，才必须加入 Event Head/Watermark 和单独的
ReportReady Derivation Receipt；该 Receipt 未冻结/实现前两个 Root 继续 fail closed。

## 7. FK 与 Cleanup 子图

`10600` 的 immediate exact FK 固定为：

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

`10600` pre-DDL 先断言 StopCommit 与 RESEARCH_STOP non-ready DomainTerminal 均为零，
禁止合成历史 Receipt；既有 READY/STALE 行保留且新列为 NULL。随后两表增加
`stop_derivation_receipt_id uuid/hash text`：StopCommit 两列 NOT NULL；DomainTerminal
仅 RESEARCH_STOP 的 PARTIAL/NEEDS_MORE_RESEARCH/INCONCLUSIVE 要求两列非空，其余为
NULL。两表均以 `(S,run_id,id,hash)` immediate FK 到 Stop Receipt exact UQ；Root 重算
Hash，并断言两组列逐字相等，禁止只存 ID 或 caller Hash。

全部展开 `S/run` candidate key，禁止 JSON/hash 冒充 FK。Cleanup 必须 child-first：
StopCommit → Terminal → Stop → Candidate → Attestation → Coverage →
ArtifactCommitOperation → Budget/Watermark → Input Event/Head；Resource 侧
Budget Event → Transition → Reservation → Step → Head；
最后删除 current Head+bound Policy/Enumerator Version。唯一 phase/closed set 取 Cleanup
分册，不能让 `10600` 表逃逸 residual。

## 8. C2 锁 rank 与 currentness

唯一全局锁序只取 Database Surface §3；本文不建立第二张 rank 表。C2 插入位置固定为：
Artifact 后锁 `Budget Policy→Resource Head→Reservation→Budget Event`，再进入
Readiness/Frontier/Terminal；业务锁完成后才锁 Input Event Head，最后锁 Receipt
semantic/idempotency key。逐行 `FOR UPDATE NOWAIT`，禁止 join lock。

所有入口先锁 Run，因此 Resource writer 的 `Run→Brief→Budget Head→Reservation`、
普通 Artifact writer 的 `Run→Artifact`、首 Brief writer 的 `Run→Artifact→Head→Event`
与 Root 不形成反向环。Input Event Head 永远位于现有
函数业务锁之后，不存在 Head→Run/Artifact/Reservation 的入口；取得 Receipt 锁后也不得
回到 Artifact/Resource/Frontier。

当前 Stop/Publish latent SQL body 的锁序不满足该序列，不能通过删除早期 `return` 启用；
C2a 必须重写 Stop 为上述顺序，Publish/Consume 保持固定拒绝。Artifact committer 也必须
在 Artifact 前取得 Relation Pair lock，不能先写 Artifact 再反向取得 Pair。
C2a 先持有 Terminal absent-key advisory/已有行锁，再锁已绑定 Budget Snapshot、插入三张
新 Receipt，最后 INSERT
Terminal；最后一步不取得新的 lock rank。Receipt semantic/idempotency absent key 也须先
advisory，避免并发不存在行穿透。

non-ready Terminal 是吸收态。所有 Step/Reserve/Begin/Start、新 Artifact/Frontier、
Budget Snapshot/Enumerator Attestation writer 在锁 Run 后都重验 Terminal absent；Stop
胜出后仅可 replay 其前已存在的 exact operation，不得新签发。只允许已发生 I/O 的 late
terminal、Settle/Cancel/Abandon 对账，以及 Retention/Cleanup 在 Terminal 后继续；
它们不能创建新 Invocation/Artifact、改变 Terminal 或重新签发 Stop Receipt。`10600`
必须把该 guard 加入所有 Resource/Invocation RPC，不能只保护 Artifact committer。

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

任何失败都发生在 terminal INSERT 前。并发同一 semantic input 只有一个 Receipt/Terminal；
loser 只可 exact replay 相同结果或得到 typed conflict，不能产生第二次可见副作用。

## 9. PostgreSQL 17 Oracle 与交付分段

### 9.1 C2a 必过

1. **Parity**：全部 golden/reject vector 在 TS/PG17 通过；旧 DB hash 不改义。
2. **正路径**：PARTIAL、NEEDS_MORE_RESEARCH、INCONCLUSIVE 各提交一次 exact Receipt
   chain 与唯一 terminal；同键 replay 返回同一持久结果。
3. **Mutation**：改 decision/version/universe/EIG/Budget/Policy/Coverage/disclosure/
   Ref hash，均在 terminal 前失败。
4. **Authority mutation**：expired/revoked capability、epoch/principal/scope/run
   换绑、historical revision、cross-run Receipt 全失败。
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

### 9.2 C2b 之后才可开放

Input Event append/head、Watermark Receipt、ReportReady Derivation Receipt、source
allowlist mutation、head advance stale、Publish/Consume/Revocation concurrency 与
Hosted Supabase/Docker 双连接 parity 全部通过后，才可移除 Publish/Consume 的固定拒绝。
缺任一项只能报告 `PARTIAL_IMPLEMENTATION`。

每阶段独立提交：合同/研究→Migration/TS/Adapter→PG17→Hosted/Docker；Codex 阻断项在
同阶段修复。合成 Fixture 不得冒充业务/Release 证据。
