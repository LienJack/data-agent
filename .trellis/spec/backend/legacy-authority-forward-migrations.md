# 旧权威后继评审闭包

> 本文记录旧环境缺失后继发布治理闭包时的前向 Migration 与人工审批合同。

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
