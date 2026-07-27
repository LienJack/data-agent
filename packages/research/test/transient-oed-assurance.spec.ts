import { describe, expect, it } from "vitest";
import {
  lookupTransientOedAssuranceMetadata,
  registerTransientOedAssuranceMetadata,
  type TransientOedAssurance,
  type TransientOedAssuranceMetadata,
} from "../src/internal/transient-oed-assurance.js";
import { hashes } from "./fixtures.js";

describe("Transient OED assurance registry", () => {
  it("单次注册、冻结防御副本，并拒绝 clone 与重复注册", () => {
    const token = Object.freeze({
      boundary: "KERNEL_CANDIDATE_ONLY",
      persistence_authority: "NONE",
      can_authorize_execution: false,
    }) satisfies TransientOedAssurance;
    const bindingIdentities = {
      brief_ref: "brief",
      evidence_plan_ref: "plan",
      query_contract_ref: "query",
      sql_artifact_ref: "sql",
      semantic_release_ref: "semantic",
      policy_receipt_ref: "policy",
    };
    const semanticChecks = {
      metric: "MATCH",
      metric_formula: "MATCH",
      time_window: "MATCH",
      timezone: "MATCH",
      grain: "MATCH",
      dimensions: "MATCH",
      grouping: "MATCH",
      joins: "MATCH",
      canonical_predicates: "MATCH",
      cohort: "MATCH",
      null_semantics: "MATCH",
      authorization_scope: "MATCH",
    } as const;
    const metadata: TransientOedAssuranceMetadata = {
      boundary: token.boundary,
      persistence_authority: token.persistence_authority,
      can_authorize_execution: token.can_authorize_execution,
      binding_identities: bindingIdentities,
      compiler_verifier_version: "compiler-verifier@1.0.0",
      compiler_evidence_hash: hashes.a,
      policy_verifier_version: "policy-verifier@1.0.0",
      policy_evidence_hash: hashes.b,
      semantic_checks: semanticChecks,
    };

    registerTransientOedAssuranceMetadata(token, metadata);
    bindingIdentities.brief_ref = "tampered-brief";

    const registered = lookupTransientOedAssuranceMetadata(token);
    expect(registered?.binding_identities.brief_ref).toBe("brief");
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered?.binding_identities)).toBe(true);
    expect(Object.isFrozen(registered?.semantic_checks)).toBe(true);
    expect(lookupTransientOedAssuranceMetadata({ ...token })).toBeNull();
    expect(() => registerTransientOedAssuranceMetadata(token, metadata)).toThrow(
      "TRANSIENT_OED_ASSURANCE_REGISTRATION_INVALID",
    );
  });
});
