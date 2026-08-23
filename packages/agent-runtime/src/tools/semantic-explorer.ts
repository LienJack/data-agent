import {
  immutableIdSchema,
  type PortResult,
  semanticExplorerObjectIdentitySchema,
  semanticRelationshipSearchRequestSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import type { ServerOwnedToolDescriptor } from "./registry.js";

const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
const domainInputSchema = z.strictObject({ semantic_domain: semanticDomainSchema });
const exactReleaseInputSchema = domainInputSchema.extend({ release_id: immutableIdSchema });
const lineageInputSchema = exactReleaseInputSchema.extend({
  root: semanticExplorerObjectIdentitySchema,
  direction: z.enum(["upstream", "downstream", "both"]),
  hop_limit: z.number().int().min(1).max(6),
});
const diffInputSchema = domainInputSchema.extend({
  base_release_id: immutableIdSchema,
  target_release_id: immutableIdSchema,
});
const candidateInputSchema = domainInputSchema.extend({
  candidate_id: immutableIdSchema,
  revision_id: immutableIdSchema,
});
const listDomainsInputSchema = z.strictObject({});

export const SEMANTIC_EXPLORER_TOOL_NAMES = Object.freeze({
  listDomains: "semantic_explorer_list_domains@1",
  getActiveRelease: "semantic_explorer_get_active_release@1",
  getRelease: "semantic_explorer_get_release@1",
  searchRelationships: "semantic_explorer_search_relationships@1",
  getLineage: "semantic_explorer_get_lineage@1",
  diffReleases: "semantic_explorer_diff_releases@1",
  compareCandidate: "semantic_explorer_compare_candidate@1",
} as const);

export const SEMANTIC_EXPLORER_TOOL_DESCRIPTORS = Object.freeze([
  {
    tool_name: SEMANTIC_EXPLORER_TOOL_NAMES.listDomains,
    description: "List the semantic domains visible to the current PostgreSQL Authority scope.",
    input_schema: listDomainsInputSchema,
  },
  {
    tool_name: SEMANTIC_EXPLORER_TOOL_NAMES.getActiveRelease,
    description: "Read the current active semantic release for one allowed semantic domain.",
    input_schema: domainInputSchema,
  },
  {
    tool_name: SEMANTIC_EXPLORER_TOOL_NAMES.getRelease,
    description: "Read one exact historical semantic release by immutable release id.",
    input_schema: exactReleaseInputSchema,
  },
  {
    tool_name: SEMANTIC_EXPLORER_TOOL_NAMES.searchRelationships,
    description:
      "Search bounded BIZ, JOIN, FORMULA, BIND, and GOVERN relationships for an exact PostgreSQL release.",
    input_schema: semanticRelationshipSearchRequestSchema,
  },
  {
    tool_name: SEMANTIC_EXPLORER_TOOL_NAMES.getLineage,
    description: "Read bounded lineage for one semantic object in an exact release.",
    input_schema: lineageInputSchema,
  },
  {
    tool_name: SEMANTIC_EXPLORER_TOOL_NAMES.diffReleases,
    description: "Compare two exact semantic releases in the same allowed semantic domain.",
    input_schema: diffInputSchema,
  },
  {
    tool_name: SEMANTIC_EXPLORER_TOOL_NAMES.compareCandidate,
    description: "Compare a governed semantic candidate revision with its release baseline.",
    input_schema: candidateInputSchema,
  },
] satisfies readonly ServerOwnedToolDescriptor[]);

export interface SemanticExplorerToolService<TAuthority> {
  listDomains(authority: TAuthority): Promise<PortResult<unknown>>;
  getActive(authority: TAuthority, semanticDomain: string): Promise<PortResult<unknown>>;
  getRelease(
    authority: TAuthority,
    semanticDomain: string,
    releaseId: string,
  ): Promise<PortResult<unknown>>;
  searchRelationships(authority: TAuthority, request: unknown): Promise<PortResult<unknown>>;
  getLineage(
    authority: TAuthority,
    request: {
      readonly semantic_domain: string;
      readonly release_id: string;
      readonly root: z.infer<typeof semanticExplorerObjectIdentitySchema>;
      readonly direction: "upstream" | "downstream" | "both";
      readonly hop_limit: number;
    },
  ): Promise<PortResult<unknown>>;
  diffReleases(
    authority: TAuthority,
    semanticDomain: string,
    baseReleaseId: string,
    targetReleaseId: string,
  ): Promise<PortResult<unknown>>;
  getCandidateComparison(
    authority: TAuthority,
    semanticDomain: string,
    candidateId: string,
    revisionId: string,
  ): Promise<PortResult<unknown>>;
}

export interface SemanticExplorerToolExecutor<TAuthority> {
  execute(toolName: string, authority: TAuthority, input: unknown): Promise<PortResult<unknown>>;
}

export function createSemanticExplorerToolExecutor<TAuthority>(
  service: SemanticExplorerToolService<TAuthority>,
): SemanticExplorerToolExecutor<TAuthority> {
  const executor: SemanticExplorerToolExecutor<TAuthority> = {
    async execute(toolName, authority, input) {
      switch (toolName) {
        case SEMANTIC_EXPLORER_TOOL_NAMES.listDomains:
          listDomainsInputSchema.parse(input);
          return service.listDomains(authority);
        case SEMANTIC_EXPLORER_TOOL_NAMES.getActiveRelease: {
          const parsed = domainInputSchema.parse(input);
          return service.getActive(authority, parsed.semantic_domain);
        }
        case SEMANTIC_EXPLORER_TOOL_NAMES.getRelease: {
          const parsed = exactReleaseInputSchema.parse(input);
          return service.getRelease(authority, parsed.semantic_domain, parsed.release_id);
        }
        case SEMANTIC_EXPLORER_TOOL_NAMES.searchRelationships: {
          const parsed = semanticRelationshipSearchRequestSchema.parse(input);
          return service.searchRelationships(authority, parsed);
        }
        case SEMANTIC_EXPLORER_TOOL_NAMES.getLineage: {
          const parsed = lineageInputSchema.parse(input);
          return service.getLineage(authority, parsed);
        }
        case SEMANTIC_EXPLORER_TOOL_NAMES.diffReleases: {
          const parsed = diffInputSchema.parse(input);
          return service.diffReleases(
            authority,
            parsed.semantic_domain,
            parsed.base_release_id,
            parsed.target_release_id,
          );
        }
        case SEMANTIC_EXPLORER_TOOL_NAMES.compareCandidate: {
          const parsed = candidateInputSchema.parse(input);
          return service.getCandidateComparison(
            authority,
            parsed.semantic_domain,
            parsed.candidate_id,
            parsed.revision_id,
          );
        }
        default:
          return {
            ok: false,
            error: {
              code: "MODEL_TOOL_NOT_REGISTERED",
              message: "Agent 只能调用服务端固定注册的语义 Explorer 工具。",
              retryable: false,
            },
          };
      }
    },
  };
  return Object.freeze(executor);
}
