import {
  type SemanticCandidateDraft,
  type SemanticCandidateOperation,
  type SemanticChangeProposal,
  semanticCandidateDraftSchema,
} from "@data-agent/contracts";

export interface BuildAgentCandidateDraftInput {
  readonly proposal: SemanticChangeProposal;
  readonly semantic_domain: string;
  readonly idempotency_key: string;
  readonly selected_operation_ids: readonly string[];
  readonly origin_proposal_digest?: string;
}

function diffPath(operation: SemanticCandidateOperation): string {
  const collection = {
    BUSINESS_ENTITY_TYPE: "business_ontology.entities",
    DIMENSION: "dimensions",
    METRIC: "metrics",
    RELATIONSHIP: "relationships",
    PHYSICAL_BINDING: "physical_binding.entries",
  }[operation.target_type];
  return `${collection}.${operation.target_id}`;
}

export function buildAgentSemanticCandidateDraft(
  input: BuildAgentCandidateDraftInput,
): SemanticCandidateDraft {
  const selectedIds = new Set(input.selected_operation_ids);
  const selected = input.proposal.operations.filter((operation) =>
    selectedIds.has(operation.operation_id),
  );
  if (selected.length === 0 || selected.length !== selectedIds.size) {
    throw new Error("SEMANTIC_CANDIDATE_SELECTION_INVALID");
  }

  const maxRisk = selected.reduce(
    (current, operation) =>
      Math.max(current, ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(operation.impact.risk_level)),
    0,
  );

  return semanticCandidateDraftSchema.parse({
    schema_version: "semantic-candidate-draft@1.0.0",
    title: `Agent 语义候选：${input.semantic_domain}`,
    description: `${input.proposal.summary}（${selected.length} 项待人工审核，未发布）`,
    semantic_domain: input.semantic_domain,
    change_class: maxRisk >= 2 ? "MAJOR" : "MINOR",
    risk_level: ["LOW", "MEDIUM", "HIGH", "CRITICAL"][maxRisk],
    idempotency_key: input.idempotency_key,
    source_payload: {
      schema_version: "semantic-source-payload@1.0.0",
      source_kind: "AGENT",
      content: {
        proposal_digest: input.origin_proposal_digest ?? input.proposal.proposal_digest,
        reviewed_operations_digest: input.proposal.proposal_digest,
        compile_run_id: input.proposal.compile_run_id,
        source_revision_id: input.proposal.source_revision_id,
        feature_digest: input.proposal.feature_digest,
        selected_operations: selected,
      },
    },
    diff: {
      schema_version: "semantic-diff@1.0.0",
      summary: input.proposal.summary,
      operations: selected.map((operation) => {
        if (operation.action === "CREATE") {
          return { path: diffPath(operation), change_type: "ADD", after: operation.payload };
        }
        if (operation.action === "MARK_STALE") {
          return {
            path: diffPath(operation),
            change_type: "MODIFY",
            before: { target_id: operation.target_id, state: "CURRENT_RELEASE" },
            after: { target_id: operation.target_id, state: "STALE" },
          };
        }
        return {
          path: diffPath(operation),
          change_type: "MODIFY",
          before: { target_id: operation.target_id, state: "CURRENT_RELEASE" },
          after: operation.payload,
        };
      }),
    },
  });
}
