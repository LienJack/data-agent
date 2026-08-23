import {
  canonicalizeJson,
  type PortResult,
  type SemanticApplicationAuthority,
  type SemanticBindingImpactAnalyzeRequest,
  type SemanticBindingImpactAuthorityBundle,
  type SemanticBindingImpactCommitReceipt,
  type SemanticBindingImpactPort,
  type SemanticBindingImpactSafeProjection,
  semanticBindingImpactAnalyzeRequestSchema,
  verifySemanticBindingImpactAuthorityBundle,
  verifySemanticBindingImpactCommitReceipt,
} from "@data-agent/contracts";
import { buildSemanticCandidateDraftFromOperations } from "../candidate-generation/reducer.js";
import { planSemanticBindingImpact } from "../induction/binding-impact-planner.js";

export interface SemanticBindingImpactServiceDependencies {
  readonly store: SemanticBindingImpactPort;
}

function failure<T>(code: string, message: string, retryable = false): PortResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

function scopeMatches(authority: SemanticApplicationAuthority, semanticDomain: string): boolean {
  return (
    authority.scope.semanticDomain === semanticDomain &&
    authority.allowedDomains.includes(semanticDomain)
  );
}

export function createSemanticBindingImpactService(
  dependencies: SemanticBindingImpactServiceDependencies,
) {
  return Object.freeze({
    async analyze(
      authority: SemanticApplicationAuthority,
      requestInput: SemanticBindingImpactAnalyzeRequest,
    ): Promise<PortResult<SemanticBindingImpactCommitReceipt>> {
      const request = semanticBindingImpactAnalyzeRequestSchema.parse(requestInput);
      if (!scopeMatches(authority, request.semantic_domain)) {
        return failure(
          "SEMANTIC_BINDING_IMPACT_SCOPE_FORBIDDEN",
          "Binding Impact 请求不属于当前 Workspace 语义域。",
        );
      }
      const loaded = await dependencies.store.loadAuthority(authority.capabilityInput, request);
      if (!loaded.ok) return loaded;
      let authorityBundle: SemanticBindingImpactAuthorityBundle;
      try {
        authorityBundle = await verifySemanticBindingImpactAuthorityBundle(loaded.value);
      } catch {
        return failure(
          "SEMANTIC_BINDING_IMPACT_AUTHORITY_MISMATCH",
          "Binding Impact Authority bundle 未通过内容闭包校验。",
        );
      }
      if (
        canonicalizeJson(authorityBundle.scope) !==
          canonicalizeJson({
            app_id: authority.scope.appId,
            tenant_id: authority.scope.tenantId,
            environment: authority.scope.environment,
            semantic_domain: request.semantic_domain,
          }) ||
        authorityBundle.datasource_id !== request.datasource_id ||
        authorityBundle.drift.event.drift_event_id !== request.drift_event_id
      ) {
        return failure(
          "SEMANTIC_BINDING_IMPACT_AUTHORITY_MISMATCH",
          "Binding Impact Authority bundle 与请求身份不一致。",
        );
      }

      const plan = await planSemanticBindingImpact(authorityBundle);
      const candidateDraft =
        plan.status === "REVIEW_REQUIRED"
          ? buildSemanticCandidateDraftFromOperations({
              semantic_domain: request.semantic_domain,
              idempotency_key: plan.impact_id,
              title: `Schema Drift Binding Impact：${request.semantic_domain}`,
              description: `${plan.direct_impacts.length} 个直接影响、${plan.transitive_impacts.length} 个传递影响，待人工审核且未发布。`,
              summary: "Schema drift 使当前 Published Release 中的绑定或下游语义对象需要重新验证。",
              source_kind: "SCHEMA_DISCOVERY",
              source_content: {
                schema_version: "semantic-binding-impact-candidate-source@1.0.0",
                impact_id: plan.impact_id,
                plan_hash: plan.plan_hash,
                authority_input_hash: plan.authority_input_hash,
                drift_ref: plan.drift_ref,
                release_ref: plan.release_ref,
                review_only: true,
              },
              operations: plan.candidate_operations,
            })
          : null;
      const committed = await dependencies.store.commit(authority.capabilityInput, {
        plan,
        candidate_draft: candidateDraft,
      });
      if (!committed.ok) return committed;
      try {
        const receipt = await verifySemanticBindingImpactCommitReceipt(committed.value);
        if (
          receipt.impact_id !== plan.impact_id ||
          receipt.plan_hash !== plan.plan_hash ||
          receipt.authority_input_hash !== plan.authority_input_hash ||
          receipt.status !== plan.status ||
          (candidateDraft === null) !== (receipt.candidate_ref === null)
        ) {
          throw new TypeError("SEMANTIC_BINDING_IMPACT_COMMIT_SUBSTITUTED");
        }
        return { ok: true, value: receipt };
      } catch {
        return failure(
          "SEMANTIC_BINDING_IMPACT_UNAVAILABLE",
          "Binding Impact Authority 返回了不一致的提交回执。",
          true,
        );
      }
    },

    get(
      authority: SemanticApplicationAuthority,
      input: { readonly semantic_domain: string; readonly impact_id: string },
    ): Promise<PortResult<SemanticBindingImpactSafeProjection>> {
      if (!scopeMatches(authority, input.semantic_domain)) {
        return Promise.resolve(
          failure(
            "SEMANTIC_BINDING_IMPACT_SCOPE_FORBIDDEN",
            "Binding Impact 不属于当前 Workspace 语义域。",
          ),
        );
      }
      return dependencies.store.getSafeProjection(authority.capabilityInput, input);
    },
  });
}

export type SemanticBindingImpactService = ReturnType<typeof createSemanticBindingImpactService>;
