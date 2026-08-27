# Conversational Root Harness 技术设计

## 1. 现状与恢复目标

当前数据库已按 Conversation 保存消息，但 `ProviderTaskArtifact` 和 direct dispatcher 只把当前 question 交给 Root；Root 仅执行 `INITIAL` 与 `DIRECT_ANSWER_REVIEW`，Subagent 结果不会形成下一次 Root 决策。Semantic 只产出面向用户的 AnalysisReport，Text2SQL 又拒绝任何输入 Artifact。

恢复后的数据流是：

```text
Conversation snapshot
  -> ProviderTaskArtifact v2
  -> Root turn
  -> admitted Subagent call(s)
  -> accepted Artifact + RootToolObservation
  -> checkpoint
  -> next Root turn
  -> verified final answer
  -> Conversation agent message
```

Root 是唯一自然语言决策者；Host 保留 authority/admission/security，不增加第二套 planner 或 workflow。

业务执行模型是动态 Agent Tool Loop。Root 不预先知道完整链路，只从当前 Conversation、上一轮 Tool Result 和 verifier feedback 决定当前下一步：

```ts
while (turns < maxTurns) {
  const decision = await root.next(messages, toolResults);
  if (decision.finalAnswer) return verifyAndPublish(decision.finalAnswer);
  const results = await executeCurrentToolCalls(decision.toolCalls);
  messages.push(...results);
}
```

Host 不选择后续业务步骤。当前 turn 的多个 Tool Call 只有在它们已具备全部已验收输入且互不依赖时才可并行；并行不改变 Root 的逐轮决策模型。

## 2. Conversation Context

`provider-task-artifact@2.0.0` 包含：

```ts
type ProviderTaskArtifactV2 = {
  schema_version: "provider-task-artifact@2.0.0";
  conversation_id: string;
  conversation_resource_version: number;
  current_message: { message_id: string; content: string };
  visible_messages: Array<{
    message_id: string;
    role: "user" | "agent";
    type: string;
    content: string;
    run_id: string | null;
    content_hash: string;
  }>;
  context_summary_ref: ArtifactReference | null;
  context_selection_hash: string;
};
```

ProviderTask commit RPC 从 exact EffectiveConfig receipt 读取 Run 已冻结的 conversation binding，并以 `run.accepted` 对应 message 的 `created_at + message_id` 为上界。它不再要求提交时 live Conversation version 仍等于冻结版本，因此 admission 后并发追加的新消息既不会进入旧 Run，也不会让旧 Run 误失败。选择器验证 current message 唯一且为最后 user message，再以稳定顺序保留最近对话；超预算部分由 summary ref 覆盖。`context_selection_hash` 对 conversation/version/current/selected message identities/hashes/summary ref 作 canonical hash。

Provider assembler 保留各消息原 role；历史内容不能进入 system。当前 Run 内 `RootToolObservation` 使用 assistant/tool messages 追加，且只投影 safe fields。

## 3. Root Loop 状态机

```text
READY(turn=0)
  -> ROOT_DECISION
     -> FINAL_ANSWER -> VERIFY -> TERMINAL | VERIFIER_FEEDBACK
     -> TOOL_CALLS -> ADMIT -> EXECUTE -> OBSERVATIONS -> CHECKPOINT
  -> READY(turn+1)
  -> BUDGET_EXHAUSTED (turn=4)
```

`max_root_turns=4` 是正常执行预算，不计入 provider retry。每轮 identity：

```text
root:{run_id}:{turn_index}
delegation:{run_id}:{turn_index}:{tool_call_id}
```

Checkpoint 复用现有 Root/lease state，持久化 turn index、accepted observations、terminal flag 和 exact correlations。恢复先加载已完成 logical call 与 Artifact；不得重新调用 provider/SQL/Sandbox。若同 logical id payload/hash 不同，失败关闭。

Root Provider turn 必须走既有 audited invocation authority：先提交 AgentDataProjectionReceipt 和 invocation intent，再 dispatch；完成响应写入受保护 ProviderResponseArtifact。相同 `root:{run_id}:{turn_index}` 重放只读取已提交响应，dispatch 已标记但终态未知时进入 reconciliation-required，禁止普通重发。轻量 direct dispatcher 只保留给尚未迁移的非 Root 模型阶段，不能承载动态 Root turn。

每个当前 Tool Call 的入参只含 Profile、objective、requested output、已验收的 `input_artifact_refs` 和预算。不存在同轮上游选择器：某个能力若需要尚未产生的 Artifact，Root 本轮只调用生产该 Artifact 的能力；验收结果返回后，下一轮再通过普通 `input_artifact_refs` 调用消费者。

```ts
type RootToolObservation = {
  tool_call_id: string;
  profile_id: string;
  status: "COMPLETED" | "FAILED";
  output_ref: ArtifactReference | null;
  safe_projection: unknown | null;
  error_code: string | null;
};
```

安全投影只含 strict schema 下的 Artifact identity、结构化语义、QueryEvidence shape/summary、AnalysisReport/Chart refs、ambiguities 和稳定 error code。

## 4. SemanticQueryContext authority

新增 `semantic-query-context@1.0.0` Artifact。Semantic 模型只返回选择意图；Host 从 exact frozen semantic runtime closure 投影 metrics、dimensions、relationships、time semantics 和 restrictions，并计算 `context_hash`。Artifact 同时绑定 scope/run/release/datasource/schema snapshot。

Host admission 根据 Agent Card 的 optional accepted input type 允许 Text2SQL 读取该 Artifact。Text2SQL prepare 必须在任何 target connection/database I/O 前重验：

- exact current Run Artifact reference；
- release id/generation/digest；
- datasource and schema snapshot version/hash；
- selected metric/dimension/relationship 仍属于该 context；
- compiled semantic bindings 没有越界。

无 SemanticQueryContext 时继续使用 frozen release 全局上下文，因此 Semantic 是可选上游。

## 5. Analysis/final answer

Production team runtime 只执行当前 turn 已准入且互不依赖的调用，并把每个 accepted output 投影为安全 Tool Result，不提前终结 Root。Root 下一轮可基于真实结果继续调用 Analysis/Report；Analysis 使用既有 `SqlArtifact -> QueryEvidence -> typed Arrow -> operator -> DerivedAnalysisEvidence -> AnalysisReport -> Chart` 证据链。Final verifier 只接受 general text 或 current-Run accepted refs 支撑的事实。

## 6. Long-context summary

`conversation-context-summary@1.0.0` 包含 conversation id/version、current Run、covered-through id、ordered covered message ids/hashes、summary、active terms、user-confirmed constraints 和 content hash。冻结窗口固定为最近 64 条：不超过 16 条时不生成摘要；超过时把较早的最多 48 条做确定性、长度受限的抽取摘要，并至少保留最近 16 条原文。若第 16 条边界落在 assistant message，边界向前扩到最近的 user message，避免把 user/assistant pair 拆开。摘要与 ProviderTask 在同一 PostgreSQL 事务中写入现有 Artifact Store，重放必须返回 exact document/hash；旧的无摘要 ProviderTask 保持原样重放。

摘要在 provider 输入里使用明确标记的 untrusted `user` message，永不提升为 `system`。摘要 Artifact 不进入 Conversation `accepted_artifact_refs`，不能作为 SQL、semantic binding 或最终事实证据；当前 Run 需要数据事实时仍必须调用工具产生已验收 Artifact。

## 7. Failure, concurrency and recovery

| Failure | Stable behavior |
| --- | --- |
| EffectiveConfig/conversation/current message mismatch | provider 前拒绝 |
| later message races with frozen Run | later message excluded |
| cross-scope/conversation ref | not-found-or-denied |
| Provider decision invalid/mixed/unknown | strict parse failure |
| duplicate logical call same hash | replay existing result |
| duplicate logical call different hash | correlation failure |
| Semantic context stale/cross-run/out-of-range | target I/O 前拒绝 |
| tool failed | safe FAILED observation; Root decides next step |
| final verifier rejects | structured feedback consumes next Root turn |
| turn 4 has no accepted final | `ROOT_AGENT_TURN_BUDGET_EXHAUSTED` |
| process crash after committed side effect | restore checkpoint/ref; no repeat |

Concurrent runs in one Conversation share the admission snapshot only; each Run has isolated loop/checkpoint/tool identities. Message append after snapshot cannot mutate either context selection.

## 8. Storage and migration

Root context v2 已由 10784 演进现有 lease/provider-task RPC。C6 发现不能通过修改已提交 10784 来安全加入 summary authority，因此新增且只新增后继 10785：不建表，只演进同一 commit/load RPC、私有 validator 与现有 Artifact Store RLS。10785 保留 v1 load 和 10784 已提交的无摘要 v2 replay，不 UPDATE/DELETE 历史 Artifact；摘要与新 ProviderTask 同事务提交。

## 9. File ownership

- Contracts: provider invocation, artifact types/new schemas, subagent harness, effective config/runtime.
- Agent Runtime: root harness, built-in cards, delegation admission.
- Worker: direct dispatcher, root turn/delegation/production runtimes, team tools, Text2SQL runtime, new conversation context builder.
- Platform: workspace data repository and provider invocation store.
- Web: validation-only unless a concrete missing current-conversation binding defect is proven.
- Database: 10784 Root context migration + 10785 summary follow-up；均只演进同一 RPC authority，不新增表。

W2-owned dirty files, migration 10783 and the retained E3 database are excluded from this task.

## 10. Rejected alternatives

- Host keyword/regex classifier or fixed business workflows: violates Root authority.
- 同轮消费者引用同轮生产者、一次输出完整业务链或 Host 分层调度：把动态决策退化为预编排流程。
- Always force Semantic before Text2SQL: removes valid direct path and creates fixed workflow.
- Feed historical assistant prose as evidence: breaks Artifact authority.
- Relax all Team inputs to allow cross-Run refs: expands scope and weakens exact Run isolation.
- New memory/vector/router/business tables: unnecessary second authority.
- Retry the whole Run after crash: can duplicate model, SQL or Sandbox effects.
