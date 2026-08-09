import "server-only";

import type {
  PortResult,
  SemanticExplorerCandidateComparison,
  SemanticExplorerDiff,
  SemanticExplorerDomainSummary,
  SemanticExplorerLineage,
  SemanticExplorerObject,
  SemanticExplorerObjectIdentity,
  SemanticExplorerReleaseTimeline,
  SemanticExplorerSnapshot,
  SemanticRelationshipSearchRequest,
  SemanticRelationshipSearchResult,
} from "@data-agent/contracts";
import type {
  PostgresRelationshipIndexStore,
  PostgresSemanticExplorerReader,
  SemanticRelationshipGraphAdapter,
} from "@data-agent/platform";
import {
  buildSemanticExplorerCandidateComparison,
  buildSemanticExplorerLineage,
  buildSemanticExplorerReadModel,
  createSemanticRelationshipSearchService,
  diffSemanticExplorerSnapshots,
  SemanticExplorerKernelError,
  semanticExplorerIdentityKey,
} from "@data-agent/semantic";
import type { SemanticAuthorityContext } from "./semantic-authority";

export interface SemanticExplorerLineageRequest {
  readonly semantic_domain: string;
  readonly release_id: string;
  readonly root: SemanticExplorerObjectIdentity;
  readonly direction: "upstream" | "downstream" | "both";
  readonly hop_limit: number;
}

export interface SemanticExplorerService {
  listDomains(
    authority: SemanticAuthorityContext,
  ): Promise<PortResult<readonly SemanticExplorerDomainSummary[]>>;
  getActive(
    authority: SemanticAuthorityContext,
    semanticDomain: string,
  ): Promise<PortResult<SemanticExplorerSnapshot>>;
  getRelease(
    authority: SemanticAuthorityContext,
    semanticDomain: string,
    releaseId: string,
  ): Promise<PortResult<SemanticExplorerSnapshot>>;
  listReleases(
    authority: SemanticAuthorityContext,
    semanticDomain: string,
    limit: number,
    generationCursor: number | null,
  ): Promise<PortResult<SemanticExplorerReleaseTimeline>>;
  diffReleases(
    authority: SemanticAuthorityContext,
    semanticDomain: string,
    baseReleaseId: string,
    targetReleaseId: string,
  ): Promise<PortResult<SemanticExplorerDiff>>;
  getObject(
    authority: SemanticAuthorityContext,
    semanticDomain: string,
    releaseId: string,
    identity: SemanticExplorerObjectIdentity,
  ): Promise<PortResult<SemanticExplorerObject>>;
  getLineage(
    authority: SemanticAuthorityContext,
    request: SemanticExplorerLineageRequest,
  ): Promise<PortResult<SemanticExplorerLineage>>;
  getCandidateComparison(
    authority: SemanticAuthorityContext,
    semanticDomain: string,
    candidateId: string,
    revisionId: string,
  ): Promise<PortResult<SemanticExplorerCandidateComparison>>;
  searchRelationships(
    authority: SemanticAuthorityContext,
    request: SemanticRelationshipSearchRequest,
  ): Promise<PortResult<SemanticRelationshipSearchResult>>;
}

function kernelFailure(error: unknown): PortResult<never> {
  if (error instanceof SemanticExplorerKernelError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: "语义 Explorer 无法从当前权威材料构建安全读取模型。",
        retryable: false,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE",
      message: "语义 Explorer 权威材料不可用。",
      retryable: false,
    },
  };
}

function objectNotVisible<T>(): PortResult<T> {
  return {
    ok: false,
    error: {
      code: "SEMANTIC_EXPLORER_OBJECT_NOT_VISIBLE",
      message: "当前 Authority 不允许读取该语义对象。",
      retryable: false,
    },
  };
}

async function buildSnapshot(
  raw: Awaited<ReturnType<PostgresSemanticExplorerReader["getActiveSource"]>>,
): Promise<PortResult<SemanticExplorerSnapshot>> {
  if (!raw.ok) return raw;
  try {
    return { ok: true, value: (await buildSemanticExplorerReadModel(raw.value)).snapshot };
  } catch (error) {
    return kernelFailure(error);
  }
}

export function createSemanticExplorerService(
  reader: PostgresSemanticExplorerReader,
  relationshipOptions: {
    readonly store?: PostgresRelationshipIndexStore | null;
    readonly graph?: SemanticRelationshipGraphAdapter | null;
    readonly disabledReason?: "INDEX_DISABLED" | "INDEX_NOT_CONFIGURED";
  } = {},
): SemanticExplorerService {
  const getRelease = async (
    authority: SemanticAuthorityContext,
    semanticDomain: string,
    releaseId: string,
  ) =>
    buildSnapshot(
      await reader.getReleaseSource(authority.capabilityInput, {
        semantic_domain: semanticDomain,
        release_id: releaseId,
      }),
    );

  const getActive = async (authority: SemanticAuthorityContext, semanticDomain: string) =>
    buildSnapshot(await reader.getActiveSource(authority.capabilityInput, semanticDomain));

  const relationshipSearch = createSemanticRelationshipSearchService({
    snapshots: {
      getActive: async (capabilityInput, semanticDomain) =>
        buildSnapshot(await reader.getActiveSource(capabilityInput, semanticDomain)),
      getRelease: async (capabilityInput, semanticDomain, releaseId) =>
        buildSnapshot(
          await reader.getReleaseSource(capabilityInput, {
            semantic_domain: semanticDomain,
            release_id: releaseId,
          }),
        ),
    },
    checkpoints: relationshipOptions.store ?? null,
    graph: relationshipOptions.graph ?? null,
    disabled_reason: relationshipOptions.disabledReason ?? "INDEX_DISABLED",
  });

  const service: SemanticExplorerService = {
    async listDomains(authority) {
      const domains = await reader.listDomains(authority.capabilityInput, authority.allowedDomains);
      if (!domains.ok) return domains;
      const allowed = new Set(authority.allowedDomains);
      return {
        ok: true,
        value: domains.value.filter((domain) => allowed.has(domain.semantic_domain)),
      };
    },

    async getActive(authority, semanticDomain) {
      return getActive(authority, semanticDomain);
    },

    getRelease,

    async listReleases(authority, semanticDomain, limit, generationCursor) {
      return reader.listReleases(authority.capabilityInput, {
        semantic_domain: semanticDomain,
        limit,
        generation_cursor: generationCursor,
      });
    },

    async diffReleases(authority, semanticDomain, baseReleaseId, targetReleaseId) {
      const [base, target] = await Promise.all([
        getRelease(authority, semanticDomain, baseReleaseId),
        getRelease(authority, semanticDomain, targetReleaseId),
      ]);
      if (!base.ok) return base;
      if (!target.ok) return target;
      try {
        return { ok: true, value: diffSemanticExplorerSnapshots(base.value, target.value) };
      } catch (error) {
        return kernelFailure(error);
      }
    },

    async getObject(authority, semanticDomain, releaseId, identity) {
      const snapshot = await getRelease(authority, semanticDomain, releaseId);
      if (!snapshot.ok) return snapshot;
      const object = snapshot.value.objects.find(
        (candidate) =>
          semanticExplorerIdentityKey(candidate.identity) === semanticExplorerIdentityKey(identity),
      );
      return object ? { ok: true, value: object } : objectNotVisible();
    },

    async getLineage(authority, request) {
      const snapshot = await getRelease(authority, request.semantic_domain, request.release_id);
      if (!snapshot.ok) return snapshot;
      try {
        return {
          ok: true,
          value: buildSemanticExplorerLineage(snapshot.value, request.root, {
            direction: request.direction,
            hop_limit: request.hop_limit,
          }),
        };
      } catch (error) {
        return kernelFailure(error);
      }
    },

    async getCandidateComparison(authority, semanticDomain, candidateId, revisionId) {
      const raw = await reader.getCandidateComparison(authority.capabilityInput, {
        semantic_domain: semanticDomain,
        candidate_id: candidateId,
        revision_id: revisionId,
      });
      if (!raw.ok) return raw;
      try {
        return { ok: true, value: buildSemanticExplorerCandidateComparison(raw.value) };
      } catch (error) {
        return kernelFailure(error);
      }
    },

    async searchRelationships(authority, request) {
      if (!authority.allowedDomains.includes(request.semantic_domain)) {
        return objectNotVisible();
      }
      return relationshipSearch.search(
        {
          capability_input: authority.capabilityInput,
          scope: {
            app_id: authority.scope.appId,
            tenant_id: authority.scope.tenantId,
            environment: authority.scope.environment,
          },
        },
        request,
      );
    },
  };
  return Object.freeze(service);
}
