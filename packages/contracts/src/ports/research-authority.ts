import type { ArtifactReference } from "../artifacts/envelope.js";
import type {
  CommitCurrentGoInput,
  CommitReportReadResponseInput,
  CommitResearchStopTerminalInput,
  CommittedCurrentGo,
  CommittedCurrentRevocation,
  CommittedFrontier,
  CommittedReportReadResponse,
  CommittedResearchArtifact,
  CommittedResearchStopTerminal,
  ConsumeCurrentInput,
  ConsumedReportReadGrant,
  ConsumeReportReadGrantInput,
  CurrentReadinessConsumeResult,
  ExpiredReportReadGrant,
  ExpireReportReadGrantInput,
  FrontierAdvanceInput,
  FrontierInitializeInput,
  PublishCurrentInput,
  PublishedCurrentReadiness,
  ResearchArtifactCommitInput,
  RevokeCurrentInput,
  U6DbResult,
} from "../artifacts/research/platform.js";
import type {
  HistoricalL2ResearchDocument,
  HistoricalVersionedL2ResearchDocument,
} from "../artifacts/research/wire.js";

export interface ResearchArtifactAuthorityPort {
  commitCurrent(
    capabilityInput: unknown,
    input: ResearchArtifactCommitInput,
  ): Promise<U6DbResult<CommittedResearchArtifact>>;

  readHistorical(
    capabilityInput: unknown,
    reference: ArtifactReference,
  ): Promise<
    U6DbResult<HistoricalL2ResearchDocument | HistoricalVersionedL2ResearchDocument | null>
  >;
}

export interface ResearchVersionFrontierPort {
  initialize(
    capabilityInput: unknown,
    input: FrontierInitializeInput,
  ): Promise<U6DbResult<CommittedFrontier>>;

  advance(
    capabilityInput: unknown,
    input: FrontierAdvanceInput,
  ): Promise<U6DbResult<CommittedFrontier>>;
}

export interface CurrentReadinessPort {
  publish(
    capabilityInput: unknown,
    input: PublishCurrentInput,
  ): Promise<U6DbResult<PublishedCurrentReadiness>>;

  consume(
    capabilityInput: unknown,
    input: ConsumeCurrentInput,
  ): Promise<U6DbResult<CurrentReadinessConsumeResult>>;

  revoke(
    capabilityInput: unknown,
    input: RevokeCurrentInput,
  ): Promise<U6DbResult<CommittedCurrentRevocation>>;

  consumeGrant(
    capabilityInput: unknown,
    input: ConsumeReportReadGrantInput,
  ): Promise<U6DbResult<ConsumedReportReadGrant>>;

  expireGrant(
    capabilityInput: unknown,
    input: ExpireReportReadGrantInput,
  ): Promise<U6DbResult<ExpiredReportReadGrant>>;

  commitResponse(
    capabilityInput: unknown,
    input: CommitReportReadResponseInput,
  ): Promise<U6DbResult<CommittedReportReadResponse>>;

  commitGo(
    capabilityInput: unknown,
    input: CommitCurrentGoInput,
  ): Promise<U6DbResult<CommittedCurrentGo>>;
}

export interface ResearchStopTerminalPort {
  commit(
    capabilityInput: unknown,
    input: CommitResearchStopTerminalInput,
  ): Promise<U6DbResult<CommittedResearchStopTerminal>>;
}
