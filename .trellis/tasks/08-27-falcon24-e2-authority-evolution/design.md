# Falcon24 E2 Authority Evolution — Design

## 1. Design Goal

在不改写 E1 事实的前提下，把“E1 是唯一合法值”的实现升级成“历史 E1 + current E2”的单一 Authority 模型。
E2 是新的内容寻址 closure，不是 E1 的版本号更新；E1 与 E2 共享一套 generic PostgreSQL truth 和运行时传播路径，
但各自拥有独立 baseline、activation、gate、Run、Artifact 与 UI receipts。

## 2. Contract Boundary

### 2.1 Epoch and gate identity

- 新增规范 Epoch value schema：`E[1-9][0-9]*`，提供 ordinal parser/comparator；禁止前导零和任意文本。
- 提供纯函数 `qualificationIdForEpoch(epoch) -> <epoch>-Q1`、`campaignIdForEpoch(epoch) -> <epoch>-C1`，
  以及严格相关性校验；不存在 Q2/C2。
- `FALCON24_TARGET_AUTHORITY_EPOCH` 在本交付为 `E2`，只用于 baseline/bootstrap CLI 默认值；生产 Run/Trace/Web
  始终读取 PostgreSQL current/Run binding，不能用 target 常量替代 authority read。

### 2.2 Versioning

- 保留所有 E1 v1 schema/verify 函数用于历史读取；不在原 schema version 下放宽 literal。
- 新增 v2 material：retained assets、authority baseline、staging receipt/session、activation attempt/binding、gate manifest、
  QA/Trace UI receipt。v2 显式携带 `authority_epoch`，builder 重算 exact hash。
- 公共 decoder 使用 `v1 | v2` strict union；current builder 只签发 v2。未知版本、未知字段和 v1+E2 混搭失败关闭。
- Canonical Run/Artifact persistence binding继续保存显式 epoch/baseline/activation；E2 只改变合法值集合，不改变 exact reference 原则。

## 3. PostgreSQL Evolution

新增一个 forward-only migration（接续当前 10780），在单一事务和 migration advisory lock 下完成：

1. Preflight 当前 schema/ledger、PostgreSQL 17、E1 表/函数/约束 inventory；记录 E1 authority/gate/run/artifact/UI 行数与稳定摘要。
2. 将 `falcon24_e1_staging_*`、activation、UI receipt、gate history 表原位 rename 为 generic `falcon24_epoch_*`；
   PostgreSQL OID/FK 保持，禁止 copy/drop data。
3. 给 staging/activation/history 增加并回填 `authority_epoch='E1'`，建立 exact FK；将 E1-only CHECK 替换为 canonical Epoch
   与 derived gate identity CHECK。Runs、Effective Config、Artifact、qualification/campaign 同样改为 exact baseline FK + generic Epoch。
4. `falcon24_authority_baselines` 允许每个 Scope/Epoch 一个 activated baseline；原 one-active index 改成 per-Epoch unique。
   E1 baseline `ACTIVE` 状态保持不变，表示“曾原子激活”，不通过 UPDATE 改成 SUPERSEDED。
5. `falcon24_current_authority_epoch` 仍以 Scope 为唯一键。E2 activation RPC 锁定 current E1 和 candidate E2，验证 ordinal
   恰好 `+1`、全部 E2 receipt/hash/source/build closure 后，以一次 UPSERT 推进 pointer。异常回滚后 pointer 仍为 E1。
6. 用 generic v2 RPC 替换写入口并撤销 E1 mutating RPC 的执行权；历史读取走 generic exact-ref RPC。RPC command/version 都显式
   携带 Epoch，数据库不从 gate ID 猜 Epoch。
7. Gate begin 在同一事务归档 current E1 HOLD parent/16 slots，然后创建 E2-Q1 current；Campaign begin 只接受同一 E2 baseline
   的 winning E2 qualification。Submit/hold/status/trace/finalize 全部锁定 exact epoch/gate/attempt/run/claim fence。
8. Postflight 重算 E1 摘要和行数必须等于 preflight，校验 RLS/grants/immutability/inventory 后写 migration ledger。

不提供 down migration。迁移失败由 PostgreSQL 整事务回滚；E2 activation 失败只 HOLD 新 activation attempt，不移动 current。

## 4. Runtime and Port Changes

- `postgres-authority-epoch` port 返回 generic versioned binding；调用方必须比较 Run binding 与同事务 current binding。
- Effective Config 的 qualification/campaign fence 改为 generic derived ID，并校验 `gate epoch == run epoch == baseline epoch`。
- Repository 的 E1 SQL literal 替换为参数化 exact epoch/baseline predicate；不放宽到“任意有值”。
- Root system message 使用“current governed authority epoch”，或从 Run context 注入 exact epoch；native delegation catalog hash仍绑定 Run。
- Worker/Analysis/Publisher 对 E1 文案做中性化，但不改变 Operator、Oracle、fence、atomic publication 或公开数据边界。
- Baseline CLI 增加 explicit epoch 输入并只允许 target E2；source commit、build、contract hash变化都进入 E2 baseline。

## 5. Web, Trace and Browser Gate

- Question Run route 接受 versioned gate fence DTO；服务端根据 current authority和数据库 gate current 校验 exact E2-Q1/E2-C1，
  不接受客户端任意 epoch 或 hidden fallback。
- API client、QA store、browser trace gate、qualification/campaign CLI 使用 shared gate derivation函数，不复制 literal。
- Resolution Trace loader先从 Run解析 exact epoch/baseline，再读取同 Epoch Artifact/Publisher/UI receipt。历史 E1 Trace仍按 v1渲染；
  E2 title显示 exact epoch，禁止固定“E1 Publisher”。
- UI receipt v2绑定 Run epoch、baseline、activation、Web build、viewport、DOM/screenshot hash；QA/Trace pair必须同源。
- Browser操作继续使用 snapshot/ref/re-snapshot和真实 composer submit；不得直接拼 Run URL 或用 API-only 结果计 PASS。

## 6. Operational Data Flow

```text
immutable E1 ACTIVE baseline + E1-Q1 HOLD history
  -> forward migration preserves every E1 fact
  -> stage E2 receipts for db24/semantic/model/profile/operator/sandbox
  -> build E2 baseline from exact new source + builds + contracts
  -> atomic E1-current -> E2-current activation
  -> archive E1-Q1 HOLD current into generic history
  -> E2-Q1 immutable attempt: G1 1 + G2 5 + G3 5 + G4 5
  -> winning E2 qualification certificate
  -> E2-C1 immutable attempt: 30 serial slots
  -> final local functional report (production isolation remains HOLD)
```

## 7. Compatibility and Security

- E1 v1 is read-only compatibility, not a hidden write shim. Any E1 mutating RPC after E2 activation is revoked or rejects stale current.
- No E1 bytes are rewritten to v2. Cross-version decoders return a normalized in-memory projection while preserving original identity/hash.
- Public trace remains content-first and bounded; no provider response, prompt, SQL DSN, credentials, raw rows, sealed Oracle data or chain-of-thought。
- Scope remains `app_id + tenant_id + environment` plus principal where applicable; every SQL statement retains explicit scope predicates and RLS revalidation。
- E2 local functional PASS does not change `production_isolation_proven=false` or `production_gate=HOLD`。

## 8. Test Strategy

- Contract property/fixture tests：E1 decode、E2 build/hash、epoch ordering、gate derivation、cross-epoch rejection。
- Migration tests：fresh chain；E1 HOLD fixture原位升级；pre/post E1 hashes/counts；all-old/all-new activation；RLS/grant/DML denylist。
- Platform/Worker/Web focused tests：exact binding propagation、stale gate rejection、historical E1 trace、E2 trace/UI pair、no literal import boundary。
- Full package typecheck/build与 migration inventory。
- 正式运行：先 E2-Q1 16/16，再 E2-C1 30/30；每 slot 浏览器、Trace、Artifact、receipt、Sandbox residual全部闭合。

## 9. Rollback and Next Epoch

- Code提交前：普通 Git revert另立提交；不 amend/rewrite历史。
- Migration：事务内失败自动回滚；成功后不降级schema，E1事实仍在。
- Activation：失败/HOLD不移动 current；成功后不能回退到 E1。
- E2 activation后若 code/contract/build/frozen asset再变，停止gate并进入E3；不得覆盖E2或创建E2-Q2。
