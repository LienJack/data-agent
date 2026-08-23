import {
  type ArtifactReference,
  computeL2ArtifactContentHash,
  type L2ArtifactDocument,
  type L2ResearchDocumentCandidate,
  l2ArtifactDocumentSchema,
  parseAndHashL2ResearchDocumentCandidate,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "../errors.js";
import { preflightResearchInput } from "../input-budget.js";
import { type ArtifactReferenceFor, documentReference } from "./reference-identity.js";
import {
  memoizeSuccessfulResearchReplay,
  type ResearchRequestReplayContext,
} from "./request-replay-context.js";

type L2ArtifactType = L2ArtifactDocument["payload"]["artifact_type"];
type ResearchArtifactType = L2ResearchDocumentCandidate["payload"]["artifact_type"];

export type L2ArtifactPayloadFor<ArtifactType extends L2ArtifactType> = Extract<
  L2ArtifactDocument["payload"],
  { readonly artifact_type: ArtifactType }
>;

export type ResearchPayloadFor<ArtifactType extends ResearchArtifactType> = Extract<
  L2ResearchDocumentCandidate["payload"],
  { readonly artifact_type: ArtifactType }
>;

export type L2ArtifactDocumentFor<ArtifactType extends L2ArtifactType> = L2ArtifactDocument & {
  readonly envelope: L2ArtifactDocument["envelope"] & {
    readonly artifact_type: ArtifactType;
  };
  readonly payload: L2ArtifactPayloadFor<ArtifactType>;
};

export type ResearchDocumentFor<ArtifactType extends ResearchArtifactType> =
  L2ResearchDocumentCandidate & {
    readonly envelope: L2ResearchDocumentCandidate["envelope"] & {
      readonly artifact_type: ArtifactType;
    };
    readonly payload: ResearchPayloadFor<ArtifactType>;
  };

export interface ResolvedL2ArtifactDocumentCandidate<
  ArtifactType extends L2ArtifactType = L2ArtifactType,
> {
  readonly document: L2ArtifactDocumentFor<ArtifactType>;
  readonly ref: ArtifactReferenceFor<ArtifactType>;
}

export interface ResolvedResearchDocumentCandidate<
  ArtifactType extends ResearchArtifactType = ResearchArtifactType,
> {
  readonly document: ResearchDocumentFor<ArtifactType>;
  readonly ref: ArtifactReferenceFor<ArtifactType>;
}

async function resolveL2ArtifactDocumentCandidateUncached<ArtifactType extends L2ArtifactType>(
  input: unknown,
  expectedArtifactType: ArtifactType,
): Promise<ResearchKernelResult<ResolvedL2ArtifactDocumentCandidate<ArtifactType>>> {
  const budget = preflightResearchInput(input);
  if (!budget.ok) return budget;

  const parsed = l2ArtifactDocumentSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.payload.artifact_type !== expectedArtifactType ||
    parsed.data.envelope.artifact_type !== expectedArtifactType
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      `${expectedArtifactType} 必须是 strict L2 Document。`,
    );
  }
  if ((await computeL2ArtifactContentHash(parsed.data)) !== parsed.data.envelope.content_hash) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      `${expectedArtifactType} Envelope content_hash 与完整 Document 不匹配。`,
    );
  }
  const document = parsed.data as L2ArtifactDocumentFor<ArtifactType>;
  return researchKernelSuccess({
    document,
    ref: documentReference(document),
  });
}

export function resolveL2ArtifactDocumentCandidate<ArtifactType extends L2ArtifactType>(
  input: unknown,
  expectedArtifactType: ArtifactType,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResolvedL2ArtifactDocumentCandidate<ArtifactType>>> {
  return memoizeSuccessfulResearchReplay(
    requestContext,
    `document:l2:${expectedArtifactType}`,
    input,
    () => resolveL2ArtifactDocumentCandidateUncached(input, expectedArtifactType),
  );
}

async function resolveResearchDocumentCandidateUncached<ArtifactType extends ResearchArtifactType>(
  input: unknown,
  expectedArtifactType: ArtifactType,
): Promise<ResearchKernelResult<ResolvedResearchDocumentCandidate<ArtifactType>>> {
  const budget = preflightResearchInput(input);
  if (!budget.ok) return budget;

  try {
    const parsedAndHash = await parseAndHashL2ResearchDocumentCandidate(input);
    const parsed = parsedAndHash.document;
    if (
      parsed.payload.artifact_type !== expectedArtifactType ||
      parsed.envelope.artifact_type !== expectedArtifactType
    ) {
      return researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        `${expectedArtifactType} 必须是 strict Research Document Candidate。`,
      );
    }
    if (parsedAndHash.content_hash !== parsed.envelope.content_hash) {
      return researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        `${expectedArtifactType} Envelope content_hash 与完整 Document 不匹配。`,
      );
    }
    const document = parsed as ResearchDocumentFor<ArtifactType>;
    return researchKernelSuccess({
      document,
      ref: documentReference(document),
    });
  } catch {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      `${expectedArtifactType} 必须通过 strict Research Wire 与 Reference 闭包校验。`,
    );
  }
}

export function resolveResearchDocumentCandidate<ArtifactType extends ResearchArtifactType>(
  input: unknown,
  expectedArtifactType: ArtifactType,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResolvedResearchDocumentCandidate<ArtifactType>>> {
  return memoizeSuccessfulResearchReplay(
    requestContext,
    `document:research:${expectedArtifactType}`,
    input,
    () => resolveResearchDocumentCandidateUncached(input, expectedArtifactType),
  );
}

export type { ArtifactReference };
