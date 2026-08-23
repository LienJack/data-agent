export type SemanticRelationshipIndexKernelErrorCode =
  | "SEMANTIC_RELATIONSHIP_DOMAIN_MISMATCH"
  | "SEMANTIC_RELATIONSHIP_RELEASE_MISMATCH"
  | "SEMANTIC_RELATIONSHIP_ACTIVE_RELEASE_REQUIRED";

export class SemanticRelationshipIndexKernelError extends Error {
  override readonly name = "SemanticRelationshipIndexKernelError";

  constructor(
    readonly code: SemanticRelationshipIndexKernelErrorCode,
    message: string,
  ) {
    super(message);
  }
}
