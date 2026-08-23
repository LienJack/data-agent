import {
  type RootAgentDecisionCandidate,
  rootAgentDecisionCandidateSchema,
} from "@data-agent/contracts";
import type { HarnessRoutingCase, HarnessRoutingEvidence } from "./harness-routing-suite.js";

export type HarnessRoutingObservation = Readonly<{
  decision: RootAgentDecisionCandidate;
  admitted_profile_ids: readonly string[];
  tool_calls: readonly Readonly<{ profile_id: string; tool_name: string }>[];
  accepted_evidence: readonly HarnessRoutingEvidence[];
  final_answer_fact_selectors: readonly string[];
  authorization_expansion_detected: boolean;
}>;

export type HarnessRoutingViolationCode =
  | "DECISION_INVALID"
  | "EXPECTED_DIRECT_ANSWER"
  | "EXPECTED_SUBAGENT_DELEGATION"
  | "CANDIDATE_PROFILE_MISMATCH"
  | "ADMITTED_PROFILE_MISMATCH"
  | "FORBIDDEN_PROFILE_USED"
  | "REQUIRED_TOOL_MISSING"
  | "FORBIDDEN_TOOL_USED"
  | "REQUIRED_EVIDENCE_MISSING"
  | "FINAL_ANSWER_EVIDENCE_MISSING"
  | "AUTHORIZATION_EXPANSION";

export type HarnessRoutingOracleResult = Readonly<{
  verdict: "PASS" | "FAIL";
  case_id: string;
  violations: readonly Readonly<{
    code: HarnessRoutingViolationCode;
    detail: string;
  }>[];
}>;

function sameSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function evaluateHarnessRouting(
  testCase: HarnessRoutingCase,
  observation: HarnessRoutingObservation,
): HarnessRoutingOracleResult {
  const violations: { code: HarnessRoutingViolationCode; detail: string }[] = [];
  const parsed = rootAgentDecisionCandidateSchema.safeParse(observation.decision);
  if (!parsed.success) {
    return {
      verdict: "FAIL",
      case_id: testCase.case_id,
      violations: [
        { code: "DECISION_INVALID", detail: "Root decision failed contract validation." },
      ],
    };
  }

  const candidateProfiles =
    parsed.data.kind === "TOOL_CALLS"
      ? parsed.data.tool_calls.map(({ profile_id: profileId }) => profileId)
      : [];
  if (testCase.expected.mode === "DIRECT") {
    if (parsed.data.kind !== "FINAL_ANSWER") {
      violations.push({
        code: "EXPECTED_DIRECT_ANSWER",
        detail: "The case permits the Root Agent to answer directly without a Subagent.",
      });
    }
  } else {
    if (parsed.data.kind !== "TOOL_CALLS") {
      violations.push({
        code: "EXPECTED_SUBAGENT_DELEGATION",
        detail: "The case requires a model-selected Subagent delegation.",
      });
    }
    if (!sameSequence(candidateProfiles, testCase.expected.profile_ids)) {
      violations.push({
        code: "CANDIDATE_PROFILE_MISMATCH",
        detail: `Expected candidate profiles ${testCase.expected.profile_ids.join(",")}; observed ${candidateProfiles.join(",")}.`,
      });
    }
  }

  const expectedAdmitted = testCase.expected.mode === "DIRECT" ? [] : testCase.expected.profile_ids;
  if (!sameSequence(observation.admitted_profile_ids, expectedAdmitted)) {
    violations.push({
      code: "ADMITTED_PROFILE_MISMATCH",
      detail: `Expected admitted profiles ${expectedAdmitted.join(",")}; observed ${observation.admitted_profile_ids.join(",")}.`,
    });
  }

  const usedProfiles = new Set([
    ...candidateProfiles,
    ...observation.admitted_profile_ids,
    ...observation.tool_calls.map(({ profile_id: profileId }) => profileId),
  ]);
  for (const forbidden of testCase.forbidden_profile_ids) {
    if (usedProfiles.has(forbidden)) {
      violations.push({
        code: "FORBIDDEN_PROFILE_USED",
        detail: `Forbidden profile was selected or executed: ${forbidden}.`,
      });
    }
  }

  const toolNames = new Set(observation.tool_calls.map(({ tool_name: toolName }) => toolName));
  for (const required of testCase.required_tool_names) {
    if (!toolNames.has(required)) {
      violations.push({
        code: "REQUIRED_TOOL_MISSING",
        detail: `Required tool is absent: ${required}.`,
      });
    }
  }
  for (const forbidden of testCase.forbidden_tool_names) {
    if (toolNames.has(forbidden)) {
      violations.push({
        code: "FORBIDDEN_TOOL_USED",
        detail: `Forbidden tool was used: ${forbidden}.`,
      });
    }
  }

  const evidence = new Set(observation.accepted_evidence);
  for (const required of testCase.required_evidence) {
    if (!evidence.has(required)) {
      violations.push({
        code: "REQUIRED_EVIDENCE_MISSING",
        detail: `Accepted evidence is absent: ${required}.`,
      });
    }
  }
  const selectors = new Set(observation.final_answer_fact_selectors);
  for (const required of testCase.required_fact_selectors) {
    if (!selectors.has(required)) {
      violations.push({
        code: "FINAL_ANSWER_EVIDENCE_MISSING",
        detail: `Final answer does not cite required fact selector: ${required}.`,
      });
    }
  }
  if (observation.authorization_expansion_detected) {
    violations.push({
      code: "AUTHORIZATION_EXPANSION",
      detail: "Host execution exceeded the frozen profile and run capability intersection.",
    });
  }

  return {
    verdict: violations.length === 0 ? "PASS" : "FAIL",
    case_id: testCase.case_id,
    violations,
  };
}
