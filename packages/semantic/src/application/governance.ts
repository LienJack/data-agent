import {
  type SemanticGovernancePort,
  semanticCandidateDraftSchema,
  semanticCommitPublishInputSchema,
  semanticDecisionInputSchema,
  semanticPreparePublishInputSchema,
  semanticRollbackInputSchema,
} from "@data-agent/contracts";

export function createSemanticGovernanceService(port: SemanticGovernancePort) {
  return Object.freeze({
    listDomains: port.listDomains.bind(port),
    getInboxItems: port.getInboxItems.bind(port),
    getPacketDetail: port.getPacketDetail.bind(port),
    submitDecision: (authority: Parameters<typeof port.submitDecision>[0], input: unknown) =>
      port.submitDecision(authority, semanticDecisionInputSchema.parse(input)),
    createCandidate: (authority: Parameters<typeof port.createCandidate>[0], input: unknown) =>
      port.createCandidate(authority, semanticCandidateDraftSchema.parse(input)),
    preparePublish: (authority: Parameters<typeof port.preparePublish>[0], input: unknown) =>
      port.preparePublish(authority, semanticPreparePublishInputSchema.parse(input)),
    commitPublish: (authority: Parameters<typeof port.commitPublish>[0], input: unknown) =>
      port.commitPublish(authority, semanticCommitPublishInputSchema.parse(input)),
    executeRollback: (authority: Parameters<typeof port.executeRollback>[0], input: unknown) =>
      port.executeRollback(authority, semanticRollbackInputSchema.parse(input)),
  });
}

export type SemanticGovernanceService = ReturnType<typeof createSemanticGovernanceService>;
