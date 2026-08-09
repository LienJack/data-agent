import {
  deepFreeze,
  type SemanticExplorerCandidateComparison,
  type SemanticExplorerReleaseIdentity,
  semanticExplorerCandidateComparisonSchema,
  semanticExplorerRawCandidateComparisonSchema,
} from "@data-agent/contracts";
import { explorerFailure } from "./errors.js";

type CandidateComparisonState =
  | { readonly state: "candidate"; readonly reason_code: null }
  | {
      readonly state: "stale";
      readonly reason_code:
        | "CANDIDATE_GOVERNANCE_STALE"
        | "BASE_RELEASE_MISSING"
        | "BASE_RELEASE_ID_MISMATCH"
        | "BASE_RELEASE_GENERATION_MISMATCH"
        | "BASE_RELEASE_DIGEST_MISMATCH";
    };

const RESTRICTED_DIFF_PATH =
  /(^|[._/])(runtime_authorization|restriction|predicate|parameter)([._/]|$)/i;
const PUBLIC_DIFF_ROOTS = new Set([
  "business_ontology",
  "catalog_governance",
  "dimensions",
  "formulas",
  "metrics",
  "physical_binding",
  "relationships",
]);

function publicDiffPath(path: string): string {
  if (RESTRICTED_DIFF_PATH.test(path)) return "restricted";
  const root = path
    .split(/[./]/u)
    .find((part) => part.length > 0)
    ?.toLowerCase();
  return root && PUBLIC_DIFF_ROOTS.has(root) ? root : "other";
}

function redactCandidateDiff(
  diff: ReturnType<typeof semanticExplorerRawCandidateComparisonSchema.parse>["candidate_diff"],
) {
  return {
    schema_version: diff.schema_version,
    summary: `${diff.operations.length} deterministic semantic operation(s).`,
    operations: diff.operations.map((operation) => ({
      path: publicDiffPath(operation.path),
      change_type: operation.change_type,
      ...(operation.before === undefined ? {} : { before: "[REDACTED]" }),
      ...(operation.after === undefined ? {} : { after: "[REDACTED]" }),
    })),
  };
}

function resolveState(
  candidateStatus: string,
  base: SemanticExplorerReleaseIdentity | null,
  compared: SemanticExplorerReleaseIdentity | null,
): CandidateComparisonState {
  if (candidateStatus === "STALE_REBASE_REQUIRED") {
    return { state: "stale", reason_code: "CANDIDATE_GOVERNANCE_STALE" };
  }
  if (base === null && compared === null) {
    return { state: "candidate", reason_code: null };
  }
  if (base === null) {
    return { state: "stale", reason_code: "BASE_RELEASE_MISSING" };
  }
  if (compared === null || base.release_id !== compared.release_id) {
    return { state: "stale", reason_code: "BASE_RELEASE_ID_MISMATCH" };
  }
  if (base.release_generation !== compared.release_generation) {
    return { state: "stale", reason_code: "BASE_RELEASE_GENERATION_MISMATCH" };
  }
  if (base.release_digest !== compared.release_digest) {
    return { state: "stale", reason_code: "BASE_RELEASE_DIGEST_MISMATCH" };
  }
  const projectionsMatch = (
    ["executable_projection", "relationship_projection", "runtime_restriction_projection"] as const
  ).every(
    (kind) =>
      base[kind].projection_id === compared[kind].projection_id &&
      base[kind].projection_digest === compared[kind].projection_digest,
  );
  if (!projectionsMatch) {
    return { state: "stale", reason_code: "BASE_RELEASE_DIGEST_MISMATCH" };
  }
  return { state: "candidate", reason_code: null };
}

export function buildSemanticExplorerCandidateComparison(
  input: unknown,
): SemanticExplorerCandidateComparison {
  const parsed = semanticExplorerRawCandidateComparisonSchema.safeParse(input);
  if (!parsed.success) {
    explorerFailure("SEMANTIC_EXPLORER_CANDIDATE_COMPARISON_INVALID");
  }
  const candidate = parsed.data;
  if (
    candidate.base_release?.semantic_domain !== undefined &&
    candidate.base_release.semantic_domain !== candidate.semantic_domain
  ) {
    explorerFailure("SEMANTIC_EXPLORER_CANDIDATE_COMPARISON_INVALID");
  }
  if (
    candidate.compared_release?.semantic_domain !== undefined &&
    candidate.compared_release.semantic_domain !== candidate.semantic_domain
  ) {
    explorerFailure("SEMANTIC_EXPLORER_CANDIDATE_COMPARISON_INVALID");
  }
  return deepFreeze(
    semanticExplorerCandidateComparisonSchema.parse({
      schema_version: "semantic-explorer-candidate-comparison@1.0.0",
      semantic_domain: candidate.semantic_domain,
      candidate_id: candidate.candidate_id,
      revision_id: candidate.revision_id,
      revision_number: candidate.revision_number,
      source_revision_id: candidate.source_revision_id,
      candidate_status: candidate.candidate_status,
      base_release: candidate.base_release,
      compared_release: candidate.compared_release,
      comparison_state: resolveState(
        candidate.candidate_status,
        candidate.base_release,
        candidate.compared_release,
      ),
      diff: redactCandidateDiff(candidate.candidate_diff),
    }),
  );
}
