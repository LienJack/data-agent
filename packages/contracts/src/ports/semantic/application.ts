import type {
  InboxGroup,
  InboxItem,
  SchemaFeaturePacket,
  SemanticAgentReceipt,
  SemanticBindingImpactAuthorityBundle,
  SemanticBindingImpactCommitReceipt,
  SemanticBindingImpactPlan,
  SemanticBindingImpactSafeProjection,
  SemanticCandidateCreateResult,
  SemanticCandidateDraft,
  SemanticCandidateRevisionSaveCommand,
  SemanticCandidateRevisionSaveResult,
  SemanticChangeProposal,
  SemanticCommitPublishInput,
  SemanticDecisionInput,
  SemanticExplorerDomainSummary,
  SemanticExplorerRawCandidateComparison,
  SemanticExplorerRawSourceEnvelope,
  SemanticExplorerReleaseTimeline,
  SemanticInductionCommitCommand,
  SemanticInductionCommitResult,
  SemanticInductionRejectCommand,
  SemanticInductionRejectResult,
  SemanticInductionSourceReference,
  SemanticInductionSourceRegistrationCommand,
  SemanticInductionTarget,
  SemanticManualSessionStartCommand,
  SemanticPreparePublishInput,
  SemanticRelationshipGraphManifest,
  SemanticRelationshipIndexCheckpoint,
  SemanticRelationshipSearchRequest,
  SemanticReviewPacket,
  SemanticRollbackInput,
} from "../../artifacts/index.js";
import type {
  SemanticAuthoringState,
  SemanticAuthoringStorePort,
} from "../../artifacts/semantic-authoring.js";
import type { SemanticGraphStudioSource } from "../../artifacts/semantic-graph-read.js";
import type {
  SemanticGraphProjection,
  SemanticGraphProjectionReceipt,
  SemanticGraphReleaseBinding,
} from "../../artifacts/semantic-graph-v2.js";
import type { PhysicalSchemaSnapshot, SchemaDriftEvent } from "../../catalog/index.js";
import type { AppScope, PortResult } from "../../common/index.js";
import type { JobWorkLease } from "../../jobs/index.js";
import type { KnowledgeEvidenceSelectionDetail } from "../../knowledge/index.js";
import type { AvailableModelProfile } from "../../providers/index.js";
import type { ModelProviderPort } from "../model-provider.js";

export type SemanticApplicationAuthority = Readonly<{
  authority: "POSTGRESQL";
  capabilityInput: unknown;
  scope: {
    readonly appId: string;
    readonly tenantId: string;
    readonly environment: string;
    readonly semanticDomain: string;
  };
  deploymentId: string;
  principal: string;
  semanticRole: "human-reviewer" | "publisher" | "admin" | "demo";
  allowedDomains: readonly string[];
}>;

export interface SemanticSchemaSnapshotReadPort {
  getSnapshot(
    capabilityInput: unknown,
    snapshotId: string,
  ): Promise<PortResult<PhysicalSchemaSnapshot>>;
}

export interface SemanticBindingImpactPort {
  loadAuthority(
    capabilityInput: unknown,
    input: {
      readonly semantic_domain: string;
      readonly datasource_id: string;
      readonly drift_event_id: string;
    },
  ): Promise<PortResult<SemanticBindingImpactAuthorityBundle>>;
  commit(
    capabilityInput: unknown,
    input: {
      readonly plan: SemanticBindingImpactPlan;
      readonly candidate_draft: SemanticCandidateDraft | null;
    },
  ): Promise<PortResult<SemanticBindingImpactCommitReceipt>>;
  getSafeProjection(
    capabilityInput: unknown,
    input: {
      readonly semantic_domain: string;
      readonly impact_id: string;
    },
  ): Promise<PortResult<SemanticBindingImpactSafeProjection>>;
}

export interface SemanticExplorerReadPort {
  listDomains(
    capabilityInput: unknown,
    semanticDomains: readonly string[],
  ): Promise<PortResult<readonly SemanticExplorerDomainSummary[]>>;
  getActiveSource(
    capabilityInput: unknown,
    semanticDomain: string,
  ): Promise<PortResult<SemanticExplorerRawSourceEnvelope>>;
  getReleaseSource(
    capabilityInput: unknown,
    input: { readonly semantic_domain: string; readonly release_id: string },
  ): Promise<PortResult<SemanticExplorerRawSourceEnvelope>>;
  listReleases(
    capabilityInput: unknown,
    input: {
      readonly semantic_domain: string;
      readonly limit?: number;
      readonly generation_cursor?: number | null;
    },
  ): Promise<PortResult<SemanticExplorerReleaseTimeline>>;
  getCandidateComparison(
    capabilityInput: unknown,
    input: {
      readonly semantic_domain: string;
      readonly candidate_id: string;
      readonly revision_id: string;
    },
  ): Promise<PortResult<SemanticExplorerRawCandidateComparison>>;
}

export type SemanticCompileState =
  | "RUNNING"
  | "COMPILED"
  | "AGENT_UNAVAILABLE"
  | "TIMEOUT"
  | "INVALID_OUTPUT"
  | "VALIDATION_FAILED"
  | "STALE_BASE"
  | "IDEMPOTENCY_CONFLICT";

export interface SemanticCompileBundle {
  readonly compile_run_id: string;
  readonly source_revision_id: string;
  readonly input_digest: string;
  readonly feature_packet: SchemaFeaturePacket;
  readonly agent_receipt: SemanticAgentReceipt;
  readonly terminal: SemanticCompileState;
  readonly proposal: SemanticChangeProposal | null;
  readonly candidate_id: string | null;
  readonly candidate_revision_id: string | null;
  readonly failure_code: string | null;
  readonly created_at: string;
  readonly completed_at: string | null;
}

export interface SemanticCandidateCompilePort {
  getDriftEvidence(
    capabilityInput: unknown,
    semanticDomain: string,
    datasourceId: string,
    driftEventId: string,
  ): Promise<
    PortResult<{ readonly event: SchemaDriftEvent; readonly event_storage_digest: string }>
  >;
  begin(
    capabilityInput: unknown,
    input: {
      readonly semantic_domain: string;
      readonly compile_run_id: string;
      readonly source_revision_id: string;
      readonly idempotency_key: string;
      readonly input_digest: `sha256:${string}`;
      readonly feature_packet: SchemaFeaturePacket;
      readonly agent_receipt: SemanticAgentReceipt;
    },
  ): Promise<
    PortResult<{
      readonly compile_run_id: string;
      readonly source_revision_id: string;
      readonly terminal: SemanticCompileState;
      readonly proposal_digest: string | null;
      readonly created: boolean;
    }>
  >;
  finish(
    capabilityInput: unknown,
    input: {
      readonly semantic_domain: string;
      readonly compile_run_id: string;
      readonly terminal: Exclude<SemanticCompileState, "RUNNING">;
      readonly proposal: SemanticChangeProposal | null;
      readonly failure_code: string | null;
    },
  ): Promise<PortResult<unknown>>;
  get(
    capabilityInput: unknown,
    semanticDomain: string,
    compileRunId: string,
  ): Promise<PortResult<SemanticCompileBundle>>;
  attachCandidate(
    capabilityInput: unknown,
    input: {
      readonly semantic_domain: string;
      readonly compile_run_id: string;
      readonly candidate_id: string;
      readonly candidate_revision_id: string;
    },
  ): Promise<PortResult<unknown>>;
}

export interface SemanticCandidateReviewPort {
  createCandidate(
    authority: SemanticApplicationAuthority,
    candidate: SemanticCandidateDraft,
  ): Promise<PortResult<SemanticCandidateCreateResult>>;
}

export interface SemanticGovernanceDomainInfo {
  readonly domain: string;
  readonly displayName: string;
  readonly description: string;
  readonly datasourceId: string;
  readonly isActive: boolean;
  readonly domainVersion: number;
}

export interface SemanticGovernanceDecisionResult {
  readonly decisionId: string;
  readonly decisionDigest: string;
  readonly packetClosed: boolean;
  readonly outcome: "APPROVED" | "VETOED" | "PENDING";
  readonly totalApprovals: number;
  readonly totalRejections: number;
  readonly requiredApprovals?: number;
  readonly decisionSetDigest?: string;
}

export interface SemanticGovernancePort extends SemanticCandidateReviewPort {
  listDomains(
    authority: SemanticApplicationAuthority,
  ): Promise<PortResult<readonly SemanticGovernanceDomainInfo[]>>;
  getInboxItems(
    authority: SemanticApplicationAuthority,
    group: InboxGroup,
  ): Promise<PortResult<readonly InboxItem[]>>;
  getPacketDetail(
    authority: SemanticApplicationAuthority,
    packetId: string,
  ): Promise<PortResult<SemanticReviewPacket>>;
  submitDecision(
    authority: SemanticApplicationAuthority,
    input: SemanticDecisionInput,
  ): Promise<PortResult<SemanticGovernanceDecisionResult>>;
  preparePublish(
    authority: SemanticApplicationAuthority,
    input: SemanticPreparePublishInput,
  ): Promise<PortResult<{ readonly attemptId: string }>>;
  commitPublish(
    authority: SemanticApplicationAuthority,
    input: SemanticCommitPublishInput,
  ): Promise<PortResult<{ readonly releaseId: string }>>;
  executeRollback(
    authority: SemanticApplicationAuthority,
    input: SemanticRollbackInput,
  ): Promise<PortResult<{ readonly receiptId: string }>>;
}

export type SemanticCandidateModelRuntime =
  | {
      readonly available: true;
      readonly profile: AvailableModelProfile;
      readonly model_provider: ModelProviderPort;
    }
  | { readonly available: false };

export interface SemanticCandidateModelRuntimePort {
  resolve(authority: SemanticApplicationAuthority): Promise<SemanticCandidateModelRuntime>;
}

export interface SemanticGraphStorePort {
  commit(
    capabilityInput: unknown,
    input: {
      readonly semantic_domain: string;
      readonly projection_id: string;
      readonly source_revision_id: string;
      readonly projection: SemanticGraphProjection;
    },
  ): Promise<PortResult<SemanticGraphProjectionReceipt>>;
  get(
    capabilityInput: unknown,
    semanticDomain: string,
    projectionId: string,
  ): Promise<PortResult<SemanticGraphProjection | null>>;
  getActive(
    capabilityInput: unknown,
    semanticDomain: string,
  ): Promise<PortResult<SemanticGraphStudioSource | null>>;
  bindRelease(
    capabilityInput: unknown,
    input: {
      readonly semantic_domain: string;
      readonly release_id: string;
      readonly projection_id: string;
    },
  ): Promise<PortResult<SemanticGraphReleaseBinding>>;
}

export interface SemanticCandidateRevisionPort {
  getSaved(
    capabilityInput: unknown,
    input: {
      readonly scope: AppScope;
      readonly semantic_domain: string;
      readonly principal_id: string;
      readonly authoring_run_id: string;
    },
  ): Promise<PortResult<SemanticCandidateRevisionSaveResult | null>>;
  startManual(
    capabilityInput: unknown,
    command: SemanticManualSessionStartCommand,
  ): Promise<PortResult<SemanticAuthoringState>>;
  save(
    capabilityInput: unknown,
    command: SemanticCandidateRevisionSaveCommand,
  ): Promise<PortResult<SemanticCandidateRevisionSaveResult>>;
}

export interface SemanticKnowledgeEvidencePort {
  getEvidenceSelection(
    capabilityInput: unknown,
    selectionId: string,
  ): Promise<PortResult<KnowledgeEvidenceSelectionDetail>>;
}

export interface SemanticInductionExecutionPort {
  loadTarget(
    capabilityInput: unknown,
    lease: JobWorkLease,
  ): Promise<PortResult<SemanticInductionTarget>>;
  commit(
    capabilityInput: unknown,
    lease: JobWorkLease,
    command: SemanticInductionCommitCommand,
  ): Promise<PortResult<SemanticInductionCommitResult>>;
  reject(
    capabilityInput: unknown,
    lease: JobWorkLease,
    command: SemanticInductionRejectCommand,
  ): Promise<PortResult<SemanticInductionRejectResult>>;
}

export interface SemanticInductionRegistryPort extends SemanticInductionExecutionPort {
  registerSource(
    capabilityInput: unknown,
    command: SemanticInductionSourceRegistrationCommand,
  ): Promise<PortResult<SemanticInductionSourceReference>>;
}

export interface SemanticRelationshipCheckpointPort {
  getCheckpoint(
    capabilityInput: unknown,
    input: { readonly semantic_domain: string; readonly release_id: string },
  ): Promise<PortResult<SemanticRelationshipIndexCheckpoint | null>>;
}

export interface SemanticRelationshipGraphPort {
  initialize(): Promise<void>;
  stageBuild(input: {
    readonly build_id: string;
    readonly manifest: SemanticRelationshipGraphManifest;
    readonly on_progress?: () => Promise<void>;
  }): Promise<void>;
  verifyAndSeal(input: {
    readonly build_id: string;
    readonly manifest: SemanticRelationshipGraphManifest;
  }): Promise<{ readonly node_count: number; readonly edge_count: number }>;
  search(input: {
    readonly scope: AppScope;
    readonly checkpoint: SemanticRelationshipIndexCheckpoint;
    readonly request: SemanticRelationshipSearchRequest;
  }): Promise<{
    readonly release_id: string;
    readonly release_digest: string;
    readonly relationship_projection_digest: string;
    readonly build_id: string;
    readonly manifest_digest: string;
    readonly node_keys: readonly string[];
    readonly edge_keys: readonly string[];
    readonly truncated: boolean;
    readonly truncation_reasons: readonly ("HOP_LIMIT" | "NODE_LIMIT" | "EDGE_LIMIT")[];
    readonly traversed_hops: number;
  }>;
  cleanup(input: {
    readonly scope: AppScope;
    readonly semantic_domain: string;
    readonly keep_release_ids: readonly string[];
  }): Promise<number>;
  close(): Promise<void>;
}

export type SemanticAuthoringStoreFactory = (semanticDomain: string) => SemanticAuthoringStorePort;
