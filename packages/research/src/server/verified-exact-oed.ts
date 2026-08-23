import type { ObligationExecutionDecisionPayload } from "@data-agent/contracts/artifacts";
import type { ResearchKernelResult } from "../errors.js";
import { buildObligationExecutionDecisionCandidate } from "../evidence/oed-query.js";
import type { BuildObligationExecutionDecisionCandidateInput } from "../evidence/shared.js";
import {
  type ExactOedVerifierResult,
  issueTransientOedAssuranceFromExactVerifier,
  type TransientOedAssuranceBinding,
} from "./oed-assurance.js";

export interface BuildFrozenQueryRegistryOedInput {
  readonly binding: TransientOedAssuranceBinding;
  readonly derivation_input: Omit<BuildObligationExecutionDecisionCandidateInput, "assurance">;
  readonly verifier_result: ExactOedVerifierResult & {
    readonly profile: "FROZEN_QUERY_REGISTRY";
  };
}

export interface VerifiedExactOedCandidate {
  readonly payload: ObligationExecutionDecisionPayload;
  readonly derivation_input: BuildObligationExecutionDecisionCandidateInput;
}

/**
 * Server-only bridge from one deterministic frozen-query verifier to the pure
 * OED kernel. The process-local assurance is never returned separately and
 * cannot be serialized or manufactured by an Agent caller.
 */
export async function buildFrozenQueryRegistryOedCandidate(
  input: BuildFrozenQueryRegistryOedInput,
): Promise<ResearchKernelResult<VerifiedExactOedCandidate>> {
  const derivationInput: BuildObligationExecutionDecisionCandidateInput = {
    ...input.derivation_input,
    assurance: issueTransientOedAssuranceFromExactVerifier({
      binding: input.binding,
      verifier_result: input.verifier_result,
    }),
  };
  const candidate = await buildObligationExecutionDecisionCandidate(derivationInput);
  return candidate.ok
    ? {
        ok: true,
        value: { payload: candidate.value, derivation_input: derivationInput },
      }
    : candidate;
}
