# Execution Plan

## 1. Delivery Strategy

这是一个 cross-layer 端到端 MVP，按可独立验证的纵向阶段实施。每阶段只在 `codex/knowledge-driven-semantic-layer` worktree 修改并创建 scoped commit；不得包含主 checkout 的无关文件或 Falcon 产物。

最终完成不是“页面可见”或“API 返回 200”，而是 AC1–AC10 全部具备当前代码、数据库、浏览器与真实 Text2SQL 证据。

## 2. Phase 0 — Planning and Baseline

- [x] 确认 Knowledge Revision 只自动计算影响，不自动创建 Candidate；用户重新选择证据后显式生成更新候选。
- [x] 完成 PRD convergence pass，删除已解决问题和重复表述。
- [x] 校准 `design.md`、本文件与最终 PRD。
- [x] 将 backend/frontend specs 与相关 research 加入 implement/check context。
- [x] 运行 `task.py validate`，提交最终规划摘要，取得后续明确实施批准。
- [x] 批准后运行 `task.py start`。
- [x] 记录 baseline branch/commit、dirty status、Node/pnpm/PostgreSQL versions 和现有 focused tests。

## 3. Phase 1 — Contracts and PostgreSQL Authority

Owned scope：contracts、migration renderer/source、platform knowledge/semantic repositories、focused tests。

- [x] 新增 Knowledge Document Revision、Block、Annotation、Usage、Evidence Selection strict contracts 和 hash verifier。
- [x] 新增 Working ChangeSet origin、explicit save、review-and-publish contracts。
- [x] 设计并渲染 additive migration：document revisions、blocks、annotations、selection、usage refs、candidate operation origins/save RPC。
- [x] RLS/FORCE RLS、NOLOGIN owner、narrow grants、exact scope、idempotency、CAS/fence、immutable READY records。
- [x] Platform repositories 用 `withAppTransaction` 和 AppCapability，禁止 raw route DML。
- [x] 覆盖 tamper、cross-workspace、Reference A/Payload B、stale revision、replay、concurrent save、ACL leak。

Validation：

```bash
pnpm --filter @data-agent/contracts typecheck
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/platform typecheck
pnpm --filter @data-agent/platform test:unit
pnpm dev:migrate
```

并运行新增 migration renderer verify 与 fresh PostgreSQL authority assertions。

## 4. Phase 2 — Markdown Parse and Knowledge Asset Service

Owned scope：Worker Markdown parser/index integration、Knowledge services/routes、tests。

- [x] 实现 deterministic Markdown block parser：heading、paragraph、list、table、code。
- [x] Block identity 绑定 exact file/document ref、byte range、normalized text hash、heading ancestry、parser version。
- [x] 保持 existing search chunks/vector generation 兼容；建立 block↔chunk locator，不把 vector 作为引用 authority。
- [x] 创建/list/detail/revise/annotate/usage/block selection services 与 reason codes。
- [x] 新 Revision 不覆盖旧 blocks；annotation 保留原文、修正、reason、principal 与版本。
- [x] Usage read model 从 Candidate/Release refs 反向投影并重验 ACL。
- [x] Knowledge Revision 更新计算影响，不自动创建 Candidate，也不改变 Published Release；用户重新选择 exact evidence 后显式生成更新候选。

Validation：

```bash
pnpm --filter @data-agent/worker typecheck
pnpm --filter @data-agent/worker test:unit
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/web test:unit
```

增加 UTF-8/中文、CRLF/NFC、重复段落、标题移动、表格、代码块、空文件、oversize、prompt-injection、credential policy、retry/replay 测试。

## 5. Phase 3 — Evidence-bound Knowledge Agent

Owned scope：contracts semantic candidate evidence、semantic extraction/validation、agent runtime/worker runner、tests。

- [x] Evidence Selection 只返回已授权、用户确认的 exact blocks。
- [x] Agent prompt/input/tool policy 明确禁止自动扩展 Knowledge Evidence、approve/publish/rollback。
- [x] Structured output 覆盖 entity/dimension/metric/formula/term/relationship/physical binding 与字段级证据。
- [x] Grounding 读取 exact Schema Feature Packet 与 active Graph；区分 unique/ambiguous/missing/conflict/stale。
- [x] 生成 typed Graph operations，而不是平行 semantic diff JSON。
- [x] 低置信、映射歧义、业务口径不唯一触发 clarification/open question。
- [x] Public events 展示已选证据、工具、patch、validation 与 failure，不暴露 CoT/secret/raw provider。

Validation：

```bash
pnpm --filter @data-agent/semantic typecheck
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/agent-runtime typecheck
pnpm --filter @data-agent/agent-runtime test:unit
pnpm --filter @data-agent/worker test:unit
```

加入“未选段落不能引用”、推荐段落需用户确认、Schema 只能证明物理事实、Agent 不得发布的负例。

## 6. Phase 4 — Unified Working ChangeSet and Explicit Save

Owned scope：Graph v2 operation origin/reducer adapters、candidate save repository/routes、web store、tests。

- [x] Agent chat、Knowledge Agent、Manual Editor 统一形成 Working ChangeSet；Agent 继续持久化 runtime working revisions/tool receipts，Manual 未保存操作可保持浏览器 dirty state。
- [x] Working operations 标记 origin、evidence、turn/session identity，不改变 reducer semantics。
- [x] 浏览器 Manual dirty state 不触发 governance Candidate Revision；Agent durable tool receipts 也不得自动进入 Review Inbox。
- [x] Explicit Save 服务端重放 reducer、比较 after digest、CAS 提交 patch + Candidate Revision + audit。
- [x] Save replay 幂等；stale base/concurrent editor 返回可恢复 conflict，不覆盖他人 revision。
- [x] Submit Review 只接受 saved revision；继续编辑创建 successor。

Validation：

```bash
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web test:unit
```

覆盖 unsaved no-write、multi-operation one revision、mixed origins、duplicate save、stale save、refresh warning 和 saved revision restore。

## 7. Phase 5 — Knowledge Asset UI and Direct Editor

Owned scope：workspace navigation/routes/components、Semantic Studio editor、browser tests。

- [x] 新增 workspace Knowledge 列表和详情页面，桌面/移动端可用。
- [x] 详情展示 Markdown blocks、revision diff、annotation、ACL、usage、index status 与 reason code。
- [x] Block 多选生成 Evidence Selection，并进入 Knowledge Agent Composer。
- [x] Semantic Studio 明确呈现三种入口与共享 unsaved/saved state。
- [x] Node editor 使用 discriminated forms；Edge editor 使用 registry/endpoint/attributes schema。
- [x] system-managed objects/edges 只读并提供刷新 Schema/查看来源入口。
- [x] 新 Edge Type 使用独立 proposal screen/flow。
- [x] Save Draft、Discard Unsaved、Submit Review、Review and Publish 状态清晰；离开保护可键盘访问。
- [x] `/settings` 旧 Knowledge panel 改为摘要/跳转或复用同一 read model，不形成第二套编辑体验。

Validation：

```bash
pnpm --filter @data-agent/web typecheck
pnpm --filter @data-agent/web test:unit
pnpm --filter @data-agent/web build
```

浏览器验收：Knowledge list/detail、Markdown selection、三入口、manual Node/Edge edit、read-only physical facts、unsaved leave、save/restore、mobile、keyboard、loading/empty/error。

## 8. Phase 6 — Deterministic Validation and Governance

Owned scope：semantic validators/compiler, governance adapters/routes/UI, migrations/tests。

- [x] Validation Receipt 绑定 candidate revision、graph/schema/evidence digest 与 compiler/policy version。
- [x] 实现字段、type、formula、grain/unit/time、cycle、endpoint、mapping、stale、system-managed gates。
- [x] Review-and-publish orchestration 支持创建者自审自发，但逐步重新授权。
- [x] 后端记录独立 Review Decision 与 Publish Receipt；一步命令失败时事务回滚，不留下伪 Approved 或半激活状态。
- [x] Query Grounding 只读 active Release；Candidate/working overlay 不可见。
- [x] Rollback 恢复 previous active pointer，审计与投影可重建。

Validation：

```bash
pnpm --filter @data-agent/contracts test:unit
pnpm --filter @data-agent/semantic test:unit
pnpm --filter @data-agent/platform test:unit
pnpm --filter @data-agent/web test:unit
```

再运行 semantic governance PostgreSQL assertions、并发 publish、stale base、事务失败清理、self-review capability denial/allow、rollback tests。

## 9. Phase 7 — Real Text2SQL End-to-end Proof

Owned scope：integration fixtures/scripts/tests and evidence artifacts only; do not weaken runtime gates。

- [x] 创建代表性 Markdown 指标资料和真实 PostgreSQL schema/data fixture。
- [x] 从 Knowledge page 选段生成 Candidate，并在 Agent 安全失败后通过 Manual Editor 新增术语、关系和关系类型。
- [x] Explicit Save、validation、creator self-review-and-publish 全链通过；未点击保存前数据库 Revision 数保持为 0。
- [x] Text2SQL 冻结 exact new Release binding，回答至少一个受该指标/关系影响的问题。
- [x] 执行真实 PostgreSQL SQL，保存 release/binding/compiler/AST/SQL/gate/execution/result evidence。
- [x] Rollback previous Release 后重跑，证明 binding 恢复且 Candidate 没有泄漏。

Validation：

```bash
pnpm --filter @data-agent/text2sql typecheck
pnpm --filter @data-agent/text2sql test:unit
pnpm test:integration
pnpm test:tenancy
pnpm test:security
pnpm build
```

环境级证据需单独报告 Web、PostgreSQL、Migration Ledger、Worker、Knowledge Index、Provider、Text2SQL executor 健康；未配置可选服务必须明确 reason code，不能用单个 `pnpm dev` 代替。

## 10. Final Review and Commit Policy

- [x] 对照 PRD AC1–AC10 建立逐项 evidence matrix。
- [x] 审计 `git status`、`git diff --check`、staged path allowlist 与 secrets。
- [x] 运行 focused + cross-layer + browser + PostgreSQL checks。
- [x] 更新相关 backend/frontend specs，只记录已实现和验证的约定。
- [x] 每个独立阶段默认一个 scoped commit；最终 follow-up 使用独立 scoped commit，不 amend 已有功能提交。
- [ ] 不 amend/rewrite 现有 commit，不合入主 checkout 的无关修改。
- [ ] 只有全部 AC 有当前证据时才 `task.py archive`；部分完成保持 in_progress 并写清 HOLD 项。

## 11. Primary Risk and Rollback Points

- Migration/RLS：任何 scope/grant/immutability 失败立即停止，不用 mock 代替。
- Candidate unification：不得同时保留“旧 semantic diff”和“Graph patch”两个可发布真相。
- Manual Editor：不得用任意 JSON 输入缩短实现。
- Agent evidence：任何未选段落引用都属于阻断缺陷。
- Publish：UI 成功不能替代 Review/Publish receipts 与 active pointer。
- Text2SQL：SQL 生成或 UI 回答不能替代真实 executor 和 exact release binding。
- Rollback：只切换权威 active pointer/生成正式 receipt，不删除历史 Candidate/Release/Knowledge Revision。
