# Falcon24 E2 Authority Evolution — Implementation Plan

## Preconditions

- 在 `codex/falcon24-e1-authority-reset` worktree 内工作，保留 root checkout、所有 E1 audit container 和外部 OpenSandbox。
- 每个工作包完成聚焦验证后只 stage owned files并创建 scoped commit；不提交 generated `next-env.d.ts`、`tsbuildinfo`、
  qualification manifest、截图或秘密。
- 所有 Provider credential只通过环境加载；日志、Artifact、测试 fixture和任务工件不得出现值。

## E2-1 — Versioned Epoch and Gate Contracts

- [ ] 保留 E1 v1 decoder，新增 canonical Epoch/ordinal、derived Q1/C1 IDs和 v2 retained/baseline/staging/activation/binding schemas。
- [ ] 新增 v2 qualification/campaign/UI receipt schemas；strict union规范化历史读取，current builder只发 v2。
- [ ] 更新 exports、hash fixtures、malformed/cross-Epoch tests和 build-baseline CLI explicit epoch输入。
- [ ] 验证：Contracts focused tests、typecheck、baseline determinism与 secret/legacy identity scan。
- [ ] Commit：`feat: add versioned Falcon24 authority epochs`。

## E2-2 — Forward-only PostgreSQL Authority Migration

- [ ] 新增 10781 migration：inventory/preflight、E1表原位generic rename、epoch回填、CHECK/FK/index/RLS/grant演进。
- [ ] 新增 generic staging/baseline/activation/current RPC并撤销 E1 mutating RPC；current推进要求 epoch ordinal +1。
- [ ] 泛化 Run/Effective Config/Artifact/UI receipt binding和 exact baseline FK；保留全部 E1 bytes/identity/hash。
- [ ] 泛化 qualification/campaign current/history与 gate RPC，begin E2-Q1时原子归档 E1 HOLD。
- [ ] 更新 migration renderer/inventory/test-support；证明无第二 truth、无历史 DELETE/UPDATE。
- [ ] 验证：PostgreSQL 17 fresh migration smoke、E1 HOLD fixture upgrade、rollback、concurrency、RLS/grants、pre/post digest。
- [ ] Commit：`feat: evolve Falcon24 authority storage to E2`。

## E2-3 — Platform Authority and Runtime Propagation

- [ ] 泛化 authority epoch port、effective config fence、repository predicates与 error mapping。
- [ ] Run创建、catalog、Artifact/Publisher/Analysis authority全部传播 exact current E2 binding；stale E1/current mismatch在 I/O前拒绝。
- [ ] Root prompt去除固定E1称谓；保留 stable delegation-key native batch协议。
- [ ] 更新Platform/Agent Runtime/Worker tests，加入E1历史读取与E2 current双夹具。
- [ ] 验证：focused tests、各package typecheck、production import-boundary scan。
- [ ] Commit：`feat: propagate current Falcon24 epoch through runtime`。

## E2-4 — Trace, Web and Browser Gate

- [ ] Trace loader和节点标题从Run binding解析Epoch，支持只读E1 v1与current E2 v2，不按latest/current profile回填历史。
- [ ] 泛化QA route、API client、QA store、qualification/campaign/finalization CLI和browser claim DTO。
- [ ] UI receipt v2严格绑定E2 Run/baseline/activation/build/viewport；QA与Trace receipt同源检查保持fail closed。
- [ ] 更新真实browser preflight、composer-ready/claimed-ready等待和Trace交互验证。
- [ ] 验证：Platform/Web focused tests、Web typecheck/build、browser gate mock tests、1440/390 fixtures和public-data scan。
- [ ] Commit：`feat: support E2 traces and browser gates`。

## E2-5 — Full Static and Migration Qualification

- [ ] 运行Contracts、Platform、Agent Runtime、Worker、Web相关full suites和typecheck/build。
- [ ] 运行migration inventory、fresh PostgreSQL 17 smoke、E1->E2 upgrade smoke、production import graph/security scans。
- [ ] 审核git diff、generated/untracked文件、migration checksum/ledger和所有E1历史digest。
- [ ] 修复任何缺陷；若变更发生在E2 activation前，重建E2 baseline inputs；每个独立修复提交。

## E2-6 — E2 Staging and Atomic Activation

- [ ] 在保留正式E1 HOLD历史的升级数据库应用最终10781；确认E1 parent/current/slot/run/artifact/UI证据未变。
- [ ] 重新导入/核验db24 exact 9 tables、70 columns、121445 rows和hash receipt。
- [ ] 生成新Semantic Release、Model/Profile、Operator Registry、Sandbox runtime staging receipts；production isolation保持false。
- [ ] 用最终source commit、Web/Worker build、contracts构建E2 baseline并原子推进current E1->E2。
- [ ] 记录E2 baseline/activation/source/build hashes；activation后冻结代码。若再改 frozen closure，停止并进入E3。

## E2-7 — E2-Q1 Qualification 16/16

- [ ] 创建单一immutable E2-Q1 attempt/manifest；确认E1-Q1 HOLD已原样归档。
- [ ] 严格串行执行G1 1/1、G2 5/5、G3 5/5、G4 5/5；无slot retry、resume或跨attempt拼接。
- [ ] 每个slot用真实浏览器从composer提交，等待终态，从答案进入exact Run Trace并操作节点/详情/Artifact。
- [ ] 每个slot闭合SQL->QueryEvidence->typed Arrow->Operator->Oracle->Publisher、QA/Trace receipts和residual=0。
- [ ] 任一首败立即HOLD并停止；只在门禁外诊断。若需代码/contract/build变更，转E3而不是重建E2。

## E2-8 — E2-C1 Campaign 30/30

- [ ] 仅在E2-Q1 16/16 certificate存在时创建E2-C1 attempt，绑定winning qualification和同一baseline。
- [ ] 严格串行执行5题 × COLD/WARM × 3；不复用qualification Run。
- [ ] 每个slot完成同样的browser/Trace/Artifact/receipt/reclamation closure；首败HOLD并停止。
- [ ] 30/30后finalize winning campaign和local functional evidence bundle。

## E2-9 — Completion Audit and Handoff

- [ ] 逐条核对父E1计划与本PRD AC-E2-01..10，标记proof path、identity和hash；缺证据不得视为完成。
- [ ] 更新`.trellis/spec/backend/falcon-agent-release-gate.md`为E1历史+E2 current规则，并更新必要的backend/frontend spec。
- [ ] 运行最终diff/check；提交spec与最终报告scoped commit。
- [ ] 最终报告明确：E1 HOLD、E2 16/16、E2 30/30、production isolation false/HOLD、未执行部署。
- [ ] 使用Trellis finish流程归档子任务；父任务只有在完整计划所有验收成立后才可完成。

## Risk Gates

- **G-A History mutation:** 任一E1 document/hash/identity漂移，立即停止，不提交migration。
- **G-B Dual authority:** 出现E2专用current/Run/Artifact第二真值表，退回设计，不接受兼容实现。
- **G-C Partial activation:** 并发观察到partial E2或pointer先于receipts，migration/activation不通过。
- **G-D Gate pollution:** slot内诊断/retry、API-only UI证明或跨attempt拼接，attempt必须HOLD。
- **G-E Isolation overclaim:** local PASS被标为production GO，最终验收失败。
