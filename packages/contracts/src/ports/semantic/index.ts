import type { SemanticSourceBundle } from "../../artifacts/semantic-governance.js";
import type {
  SemanticCandidateCreateResult,
  SemanticCandidateDraft,
  SemanticCommitPublishInput,
  SemanticPreparePublishInput,
} from "../../artifacts/semantic-governance-requests.js";
import type { AppScope, PortResult } from "../../common/index.js";

export interface SemanticCandidatePort {
  create(input: {
    readonly scope: AppScope;
    readonly candidate: SemanticCandidateDraft;
  }): Promise<PortResult<SemanticCandidateCreateResult>>;
  submit(input: {
    readonly scope: AppScope;
    readonly candidate_id: string;
    readonly expected_revision: number;
  }): Promise<PortResult<{ readonly submitted: true }>>;
}

export interface SemanticGovernancePublishPort {
  prepare(input: {
    readonly scope: AppScope;
    readonly command: SemanticPreparePublishInput;
  }): Promise<PortResult<{ readonly attempt_id: string }>>;
  commit(input: {
    readonly scope: AppScope;
    readonly command: SemanticCommitPublishInput;
  }): Promise<PortResult<{ readonly release_id: string }>>;
}

export interface SemanticPublishedReadPort {
  getActive(input: {
    readonly scope: AppScope;
    readonly semantic_domain: string;
  }): Promise<PortResult<SemanticSourceBundle | null>>;
}
