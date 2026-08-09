import type { SemanticExplorerErrorCode } from "@data-agent/contracts";

const REDACTED_MESSAGES: Readonly<Record<SemanticExplorerErrorCode, string>> = Object.freeze({
  SEMANTIC_EXPLORER_DISABLED: "Explorer is disabled.",
  SEMANTIC_EXPLORER_INVALID_PARAMS: "Explorer request parameters are invalid.",
  SEMANTIC_EXPLORER_UNAVAILABLE: "Explorer is unavailable.",
  SEMANTIC_EXPLORER_CONFIG_INVALID: "Explorer configuration is invalid.",
  SEMANTIC_UNAUTHENTICATED: "Explorer authentication is required.",
  SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE: "Explorer source envelope is invalid.",
  SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH: "Explorer release binding is invalid.",
  SEMANTIC_EXPLORER_PROJECTION_PAYLOAD_INVALID: "Explorer projection payload is invalid.",
  SEMANTIC_EXPLORER_SIDECAR_DIGEST_MISMATCH: "Explorer sidecar integrity check failed.",
  SEMANTIC_EXPLORER_DUPLICATE_IDENTITY: "Explorer projection contains a duplicate identity.",
  SEMANTIC_EXPLORER_DANGLING_EDGE: "Explorer projection contains an invalid reference.",
  SEMANTIC_EXPLORER_PERMISSION_DENIED: "Explorer access is not permitted.",
  SEMANTIC_EXPLORER_OBJECT_NOT_VISIBLE: "Explorer object is unavailable.",
  SEMANTIC_EXPLORER_RELEASE_NOT_FOUND: "Explorer release is unavailable.",
  SEMANTIC_EXPLORER_LINEAGE_LIMIT_INVALID: "Explorer lineage limits are invalid.",
  SEMANTIC_EXPLORER_CANDIDATE_COMPARISON_INVALID: "Explorer candidate comparison is invalid.",
});

export class SemanticExplorerKernelError extends Error {
  override readonly name = "SemanticExplorerKernelError";

  constructor(readonly code: SemanticExplorerErrorCode) {
    super(REDACTED_MESSAGES[code]);
  }
}

export function explorerFailure(code: SemanticExplorerErrorCode): never {
  throw new SemanticExplorerKernelError(code);
}
