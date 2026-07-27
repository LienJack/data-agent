import {
  embeddedNodeReferenceIdentity,
  type ProofObligationRef,
  type QueryEvidenceV2Payload,
  queryEvidenceV2PayloadSchema,
  type ResearchBriefV2Payload,
  researchBriefV2PayloadSchema,
  U6_WIRE_LIMITS,
  type U6ResearchReasonCode,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "./errors.js";
import { preflightResearchInput } from "./input-budget.js";
import { computeResearchKernelHash } from "./internal/hash.js";
import { stableCompare } from "./internal/reference-identity.js";
import { exactObjectKeys } from "./internal/value-shape.js";

export interface PreStopReadinessInput {
  readonly brief: ResearchBriefV2Payload;
  readonly material_query_evidence: readonly QueryEvidenceV2Payload[];
  readonly supplied_disclosures: readonly string[];
}

export interface PreStopReadinessFacts {
  readonly ready: boolean;
  readonly reason_codes: readonly U6ResearchReasonCode[];
  readonly required_disclosures: readonly string[];
  readonly provenance_groups: readonly string[];
  readonly remediation_obligation_refs: readonly ProofObligationRef[];
  readonly facts_hash: `sha256:${string}`;
}

function exactInputKeys(input: PreStopReadinessInput): boolean {
  return exactObjectKeys(input, ["brief", "material_query_evidence", "supplied_disclosures"]);
}

export async function derivePreStopReadinessFacts(
  input: PreStopReadinessInput,
): Promise<ResearchKernelResult<PreStopReadinessFacts>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["material_query_evidence"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["supplied_disclosures"],
        max_items: U6_WIRE_LIMITS.max_required_disclosures,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (
    !exactInputKeys(input) ||
    !Array.isArray(input.material_query_evidence) ||
    !Array.isArray(input.supplied_disclosures)
  ) {
    return researchKernelFailure(
      "RESEARCH_STOP_INPUT_INCONSISTENT",
      "Pre-stop readiness 输入必须是 exact object 与数组。",
    );
  }
  const brief = researchBriefV2PayloadSchema.safeParse(input.brief);
  const evidence = input.material_query_evidence.map((payload) =>
    queryEvidenceV2PayloadSchema.safeParse(payload),
  );
  const suppliedDisclosureSet = new Set(input.supplied_disclosures);
  if (
    !brief.success ||
    evidence.some((result) => !result.success) ||
    suppliedDisclosureSet.size !== input.supplied_disclosures.length ||
    input.supplied_disclosures.some((disclosure) => !/^[A-Z][A-Z0-9_]*$/.test(disclosure))
  ) {
    return researchKernelFailure(
      "RESEARCH_STOP_INPUT_INCONSISTENT",
      "Pre-stop readiness 必须消费 strict Brief、material QueryEvidence 与唯一 Disclosure。",
    );
  }

  const materialEvidence = evidence.flatMap((result) => (result.success ? [result.data] : []));
  const requiredDisclosures = [
    ...new Set([
      ...brief.data.source_independence_policy.required_disclosures,
      brief.data.hypothesis_universe_policy.required_disclosure,
      "L2_NON_CAUSAL",
    ]),
  ].sort(stableCompare);
  const provenanceGroups = [
    ...new Set(materialEvidence.map(({ provenance_group }) => provenance_group)),
  ].sort(stableCompare);
  const obligationByIdentity = new Map(
    materialEvidence.map(({ obligation_ref }) => [
      embeddedNodeReferenceIdentity(obligation_ref),
      obligation_ref,
    ]),
  );
  const remediationObligationRefs = [...obligationByIdentity.entries()]
    .sort(([left], [right]) => stableCompare(left, right))
    .map(([, reference]) => reference);

  const reasonCodes: U6ResearchReasonCode[] = [];
  if (
    materialEvidence.length === 0 ||
    provenanceGroups.length < brief.data.source_independence_policy.minimum_provenance_groups
  ) {
    reasonCodes.push("SOURCE_INDEPENDENCE_POLICY_UNSATISFIED");
  }
  const sourceDisclosureRequirements = new Set([
    ...brief.data.source_independence_policy.required_disclosures,
    "L2_NON_CAUSAL",
  ]);
  if (
    [...sourceDisclosureRequirements].some(
      (disclosure) => !suppliedDisclosureSet.has(disclosure),
    ) &&
    !reasonCodes.includes("SOURCE_INDEPENDENCE_POLICY_UNSATISFIED")
  ) {
    reasonCodes.push("SOURCE_INDEPENDENCE_POLICY_UNSATISFIED");
  }
  if (!suppliedDisclosureSet.has(brief.data.hypothesis_universe_policy.required_disclosure)) {
    reasonCodes.push("BOUNDED_HYPOTHESIS_UNIVERSE_UNDISCLOSED");
  }

  const hashMaterial = {
    brief: brief.data,
    material_query_evidence: materialEvidence,
    supplied_disclosures: [...input.supplied_disclosures].sort(stableCompare),
    required_disclosures: requiredDisclosures,
    provenance_groups: provenanceGroups,
    remediation_obligation_refs: remediationObligationRefs,
    reason_codes: reasonCodes,
  } as const;
  return researchKernelSuccess({
    ready: reasonCodes.length === 0,
    reason_codes: reasonCodes,
    required_disclosures: requiredDisclosures,
    provenance_groups: provenanceGroups,
    remediation_obligation_refs: remediationObligationRefs,
    facts_hash: await computeResearchKernelHash("u6-pre-stop-readiness@1", hashMaterial),
  });
}
