# 旧权威后继发布闭包

> 本文记录旧环境缺失后继发布治理或运行时依赖闭包时的前向 Migration 合同。

## 1. Scope / Trigger

- 已存在不可改写的历史 Semantic Release/Falcon authority，当前仍需保持精确
  `E3 + generation 1`，但后继发布入口因缺少 reviewer policy、assignment 或 pointer
  而失败关闭时适用。
- 该场景只允许 checksum-bound 前向 Migration 补齐治理闭包；不能 UPDATE/DELETE 历史
  Release、projection、pointer、baseline、receipt、Run、gate、Artifact 或 workspace defaults，
  也不能用手工 SQL 直接创建 review packet 或 decision。

## 2. Signatures

```text
semantic.semantic_reviewer_policy_revision
semantic.semantic_reviewer_assignment
semantic.semantic_reviewer_policy_pointer
semantic.prepare_falcon24_successor_review(jsonb) -> jsonb
semantic.human_record_semantic_review_decision(jsonb) -> jsonb
app_data_agent.u2_canonical_sha256(jsonb) -> text
app_data_agent.u6_uuid_v5(uuid,bytea) -> uuid
```

Migration 只能为 exact scope 写入 policy revision、membership-version-bound assignment、
policy pointer 与 ledger；review preparation 和 human decision 仍由上述正常治理 RPC 分开执行。

## 3. Contracts

- Migration 必须从数据库锁定并证明当前 authority epoch、semantic domain、active release
  generation 与 source release exact match；找不到 exact scope 时不猜测、不扩大范围。
- pointer 缺失时，policy revision、assignment、successor review preparation 中任一 partial
  state 都必须失败关闭。pointer 已存在时不改写，只由 postcondition 验证其完整闭包。
- 新 policy payload 和 digest 由 PostgreSQL 构造并用 canonical SHA-256 重算；assignment
  必须来自恰好一个未撤销的当前 owner membership，并绑定 exact membership version。
- 确定性 UUID 的域分隔必须在 `bytea` 中拼接：
  `convert_to(part,'UTF8') || decode('00','hex') || convert_to(next,'UTF8')`。
  PostgreSQL `text` 不允许 NUL，禁止先用 `chr(0)` 拼 text 再 `convert_to`。
- Migration 提交前验证 policy payload/digest、pointer version/digest、live assignment、
  quorum/min-reviewers exact closure。成功后仍保持 review preparation=0、decision=0、stage=0；
  通用数据库执行授权不能冒充某个 exact packet 的人工 APPROVE。
- populated upgrade 需对除 ledger 与三张允许变更表外的全部用户表做有序 canonical
  count/hash 前后比较；任何差异都视为历史权威污染。

## 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 前置 frontier/checksum、PostgreSQL 版本或 relation/function inventory 漂移 | baseline/inventory/function drift，整笔回滚 |
| policy/assignment/pointer 或 preparation 存在 partial state | `FALCON24_SUCCESSOR_REVIEW_POLICY_PARTIAL_STATE` |
| 当前未撤销 owner 不是恰好一个 | `FALCON24_SUCCESSOR_REVIEW_POLICY_OWNER_INVALID` |
| policy digest、pointer 或 assignment/quorum 闭包不一致 | `FALCON24_SUCCESSOR_REVIEW_POLICY_POSTCONDITION_FAILED` |
| 非允许变更用户表 count/hash 变化 | upgrade verification 失败，禁止继续 review/stage |
| packet 未获 exact human decision | 保持 `OPEN/PENDING + generation 1/E3`，禁止 stage/smoke/activation |

## 5. Good / Base / Bad Cases

- Good：在 exact populated clone 先执行 forward Migration，证明非允许变更表全部 byte-equivalent，
  再把同一 checksum 应用于专用数据库并通过治理 service 生成 `WAITING_REVIEW` packet。
- Base：目标环境已经有完整 policy pointer 时 Migration 不写 policy 数据，只验证现有 closure。
- Bad：为让 Finalizer 通过而手工 INSERT reviewer row、自动写 APPROVE、修补 generation 1
  projection，或把服务暂停当作原子事务替代品。

## 6. Tests Required

- 静态测试断言 exact `E3 + falcon24 + generation 1` guard、partial-state/owner error、三张允许写表，
  并拒绝受保护表 UPDATE/DELETE。
- renderer test 固定 source segments、manifest、header/body checksum 与已渲染 SQL bytes。
- PostgreSQL 17 populated-clone upgrade 覆盖真实旧环境零 policy 闭包、确定性 assignment UUID、
  canonical policy digest、ledger frontier 与 postcondition。
- upgrade 前后逐表比较所有非允许变更用户表的 row count/canonical hash；专门复核
  Falcon current、semantic/runtime pointer、workspace defaults、E1-E3/gen1 exact refs。
- governance service 必须重算 packet digest/ChangeSet hash并返回 diff、impact、quorum；测试证明
  preparation 不产生 decision/stage，只有 human decision RPC 能关闭 packet。

## 7. Wrong vs Correct

```sql
-- Wrong: PostgreSQL text 不能包含 NUL
convert_to(domain || chr(0) || environment, 'UTF8')

-- Correct: 在 bytea 哈希域拼接分隔符
convert_to(domain, 'UTF8')
  || decode('00', 'hex')
  || convert_to(environment, 'UTF8')
```

## 8. Legacy Runtime Dependency Closure Scope / Trigger

- 旧 greenfield bootstrap 已不可变发布 exact `E3 + falcon24 + generation 1`，但早于通用 publisher
  的 catalog/dependency fence 合同，因而没有 `semantic_catalog_fence` 与
  `semantic_dependency_pointer` 时适用。
- 该缺口只能由 checksum-bound 前向 Migration 补齐。Migration 必须先证明 successor stage、target-generation-2
  publish attempt、E4 baseline/session/diagnostic/formal gate 全部为零；第一次 Finalizer 若已失败关闭，也必须证明它
  没有留下上述 partial state。
- 只允许 INSERT 缺失的 fence/pointer 与 ledger。禁止 UPDATE/DELETE generation 1、E1-E3、current pointer、
  workspace defaults 或 review packet，禁止手工 SQL 伪造依赖值。

## 9. Runtime Dependency Signatures

```text
semantic.semantic_catalog_fence
semantic.semantic_dependency_pointer
semantic.semantic_source_release
semantic.semantic_publish_attempt
semantic.semantic_publication_validation_receipt
semantic.semantic_runtime_restriction_projection
app_data_agent.u2_canonical_sha256(jsonb) -> text
```

Migration 10794 从 immutable generation-1 bootstrap evidence 重算并插入：

```text
catalog_fence_epoch = 0
catalog_schema_digest = sha256:12f028d95464af08d4311a56168381d1c99dcb5ecfe8f2f11779e348db5a76e0
dependency_generation = 1
compiler_bundle_digest = sha256:ca65d92516a3e1027487918fdd838c81affd40f687ebaecb16260d02e1c1cd17
closure_policy_digest = sha256:11fae155322246aaf3e8a3219378063dd21b440bd02311b6a56205a4a825dd7b
```

这些常量是 exact fixture 的预期 postcondition，不是可由 CLI 提交的 payload。SQL 必须从 validation receipt、
bootstrap policy、historical COMMITTED attempt、source release 与 runtime restriction 的 canonical bytes 重新推导并比较。

## 10. Runtime Dependency Contracts

- 先验证 PostgreSQL 17、10793 exact frontier/checksum、当前 E3、active/runtime generation 1 exact closure；任何 scope
  或 bytes 漂移都整笔回滚。
- fence 与 pointer 必须同时缺失或同时完整。只缺一张表的 partial state 不是可修复基线，稳定失败关闭。
- bootstrap validation receipt 的 schema snapshot 重算 `catalog_schema_digest`；source release/attempt/restriction/
  validation candidate-set evidence 必须闭合为同一 `compiler_bundle_digest`；bootstrap policy、pointer、revision、
  release-set、validation 与 restriction 必须闭合为同一 `closure_policy_digest`。
- 已存在 exact fence/pointer 时只验证、不重写，重复应用保持一行 ledger、一行 fence、一行 pointer。
- populated upgrade 对除 ledger、catalog fence、dependency pointer 外的全部用户表做有序 canonical count/hash
  比较；generation 1/E1-E3/review bytes 必须完全不变。
- 10794 只补齐既有唯一 publisher 的前置 closure，不创建第二 publisher，不 stage generation 2，也不改变 current。

## 11. Runtime Dependency Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 10793 frontier/checksum、PostgreSQL 版本或 exact E3/gen1 scope 漂移 | baseline/inventory drift，整笔回滚 |
| E4、successor stage 或 target-generation-2 publish attempt 已存在 | polluted target，禁止 provisioning |
| fence/pointer 仅一者存在 | `FALCON24_SEMANTIC_DEPENDENCY_PARTIAL_STATE` |
| validation receipt、attempt、policy 或 restriction 证据缺失/不唯一 | bootstrap evidence invalid，整笔回滚 |
| 任一 canonical digest 重算不等于 exact generation-1 evidence | dependency provisioning mismatch，整笔回滚 |
| 两行均已存在且 exact | idempotent verify；不新增、不改写 |
| 非允许用户表 count/hash 变化 | populated-upgrade verification 失败，禁止 Finalizer |

## 12. Runtime Dependency Good / Base / Bad Cases

- Good：从专用 E3 数据库 exact clone 应用 10794，证明 380 张非允许用户表 count/hash drift=0，再将同一
  rendered checksum 应用于专用数据库；Finalizer 之后才可重新进入正常 stage preparation。
- Base：fence/pointer 已由通用 publisher 完整建立且值与 generation-1 bootstrap evidence exact match；Migration
  只校验 postcondition。
- Bad：看到 `SEMANTIC_SUCCESSOR_DEPENDENCY_POINTER_REQUIRED` 后直接手工 INSERT 任意 digest，或再次运行
  Finalizer 期待偶然通过。这绕过 canonical derivation、ledger checksum 与 all-old 恢复证明。

## 13. Runtime Dependency Tests Required

- 静态测试断言 exact 10793 checksum、E3/gen1 scope、零 E4/零 successor 污染、partial-state 失败与只 INSERT
  三张允许表。
- 10794 renderer/manifest 测试固定其 source segments、rendered SQL 与 header/body checksum；加入 pre-baseline HOLD 后，workspace
  migration inventory 的当前 frontier=10795、next=10796。
- PostgreSQL 17 exact populated clone：应用前 fence/pointer=0/0，应用后=1/1，replay 后仍=1/1。
- 对 380 张非允许用户表比较 row count/canonical hash；另行复核 E3 baseline、generation 1 release/projections、
  review packet/decision 与 stage/E4/diagnostic counts。
- 负例覆盖 partial fence、错误 receipt digest、错误 attempt generation、错误 policy hash 与已污染 target generation。

## 14. Runtime Dependency Wrong vs Correct

```sql
-- Wrong: 手工选择一个看似合理的 digest，绕过 immutable evidence
insert into semantic.semantic_dependency_pointer (..., compiler_bundle_digest)
values (..., 'sha256:guessed');

-- Correct: checksum-bound migration 内重算并比较 exact bootstrap evidence；
-- 只有所有 precondition 成立时，才在同一事务 INSERT fence、pointer、ledger。
select app_data_agent.u2_canonical_sha256(validation_receipt_json)
  into derived_validation_hash;
```

## 15. Scenario: Falcon Pre-baseline Staging HOLD

### 15.1 Scope / Trigger

- Trigger：Falcon successor staging session 已为 `STAGED`，supporting receipt 或 Team materialization 在 baseline 创建前失败。
- 目的：append-only 保留已写 receipts，并将 session 受控终结为 HOLD；不建立 baseline/attempt，不删除 receipt，不重用 staging id。
- Post-baseline 失败不走本 RPC，必须继续使用 activation-attempt HOLD authority。

### 15.2 Signatures

```text
falcon24StagingHoldRequestV2Schema
falcon24StagingHoldResultV2Schema
PostgresFalcon24AuthorityEpoch.holdStagingSession(capability, request)
app_data_agent.hold_falcon24_authority_staging_session(jsonb) -> jsonb
pnpm --dir apps/web hold:falcon24-authority-staging
```

锁顺序固定为 `falcon24-authority-staging advisory -> current authority FOR UPDATE -> staging session FOR UPDATE`。

### 15.3 Contracts

Request exact keys：

```json
{
  "schema_version": "falcon24-staging-hold-request@2.0.0",
  "authority_epoch": "E4",
  "staging_id": "uuid",
  "expected_retained_assets_hash": "sha256:<64 hex>",
  "failure_code": "STABLE_UPPER_SNAKE_CASE"
}
```

Adapter 仅在服务器端追加 `command_hash`。Result 固定为 `falcon24-staging-hold@2.0.0`、`status=HOLD`，并回显 exact epoch、
staging id、retained hash 与 failure code。CLI 环境键：

- required：`DATABASE_URL`、`FALCON24_STAGING_ID`、`FALCON24_EXPECTED_RETAINED_ASSETS_HASH`、
  `FALCON24_STAGING_FAILURE_CODE`、`DATA_AGENT_ALLOW_FALCON24_STAGING_HOLD=YES`；
- fixed/default：`FALCON24_AUTHORITY_EPOCH=E4`、deployment/workspace/principal 与 environment 仍按 Finalizer 的 server context 解析；
- CLI 只调用 capability authority 与 Port，禁止 `pool.query`、`client.query` 或 session payload/DML 输入。

### 15.4 Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| exact keys/schema/UUID/hash/reason/command hash 错误或含潜在秘密 | `FALCON24_AUTHORITY_STAGING_HOLD_INVALID` |
| current 不存在或 target 不是 `current+1` | `FALCON24_CURRENT_AUTHORITY_NOT_FOUND` / `FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR` |
| session 不存在或 retained hash 不同 | `...SESSION_NOT_FOUND` / `...HOLD_MISMATCH` |
| session 已有任何 baseline | `FALCON24_AUTHORITY_STAGING_HOLD_BASELINE_EXISTS` |
| session 已 HOLD 且 failure code 相同 | idempotent replay，返回同一 HOLD document |
| session 已 HOLD 但 failure code 不同 | `FALCON24_AUTHORITY_STAGING_HOLD_CONFLICT` |
| session 已 CONSUMED | `FALCON24_AUTHORITY_STAGING_SESSION_TERMINAL` |
| supporting failure 后 HOLD authority 自身失败 | `FALCON24_E4_STAGING_HOLD_FAILED`，禁止继续 baseline/activation |

### 15.5 Good / Base / Bad Cases

- Good：Finalizer 在 Team materialization 失败后调用 Port，session `STAGED -> HOLD`，原稳定 reason 继续向上抛出，current 保持 all-old。
- Base：进程在 HOLD 返回后丢失响应；同一 exact request 重放返回同一 HOLD document。
- Bad：直接 UPDATE session、删除已写 receipts、把 HOLD 恢复为 STAGED、重用同一 staging id，或让 pre-baseline RPC 接受已有 baseline。

### 15.6 Tests Required

- Contract：strict request/result、E1/未知字段/错误 hash/reason 拒绝。
- Platform：服务端 command hash、correlation id、RPC 名称、stable DB error mapping 与 exact result parse。
- Web：supporting receipt 不完整和 Team revision conflict 都先调用 HOLD；成功后抛回原 reason；HOLD 失败不得 stage baseline。
- Migration：exact 10794 checksum、PG17、helper/session inventory、owner/security-definer/search path、public revoke/backend grant、
  migration 前后 session bytes 不变。
- PostgreSQL clone：apply、first HOLD、same-reason replay、different-reason conflict、baseline-exists refusal，并确认权威库未受 scratch 影响。

### 15.7 Wrong vs Correct

```sql
-- Wrong: 绕过 capability/RLS 并留下无 failure reason 的现场修补
update app_data_agent.falcon24_authority_staging_sessions
set status='HOLD' where staging_id=:id;

-- Correct: client 只提交 exact CAS material；Adapter 生成 command_hash，RPC 锁定并验证 scope/current/session/baseline
select app_data_agent.hold_falcon24_authority_staging_session(:server_built_command);
```

当 source-owned Skill body 改变时，同样禁止复用已发布 revision：必须提高 revision，通过 Skill Registry append + CAS 推进 head；
数据库中的旧 revision bytes 即使来自重构前也属于已引用权威历史，不能按“可丢弃旧数据”处理。
