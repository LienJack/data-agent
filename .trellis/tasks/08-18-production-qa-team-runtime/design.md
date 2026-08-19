# Production Q&A Team Runtime Design

## Execution Flow

```text
lease + effective config + resolved context
  -> persist root task/context epoch
  -> semantic readiness decision (SKIPPED or governed maintenance)
  -> Text2SQL child: provider plan -> compile -> sandbox -> QueryEvidence
  -> Report child: evidence read -> provider/project -> AnalysisReport
  -> completion/verifier/acceptance
  -> Run COMPLETED only for ACCEPTED report
```

## Ports

组合现有 `PostgresTeamRunStore`、`MastraTeamRuntime`、`TeamWorkflowRegistry`、Provider Dispatch、
Resolved Context、Semantic read、Text2SQL compiler/sandbox、Artifact store 和 Report projector。新增组合层，不复制领域逻辑。

## Reliability

- Persist-before-emit：task transition 成功后才发 Agent event。
- Persist-before-effect：Tool started/dispatch receipt 成功后才调用外部 Provider/Sandbox。
- Replay 先 load Team run/open obligations/effect receipts，再决定继续或 reconcile。
- Runtime 只返回 `ACCEPTED/FAILED/NEEDS_CLARIFICATION`；最终 Run 状态仍由 Worker runner 管理。

## Scope

首个真实纵向切片覆盖 PostgreSQL datasource 和当前 E-commerce published semantic release；接口保持 adapter 化，
不把 fixture ID/SQL 写入 production runtime。
