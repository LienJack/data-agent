import {
  canonicalizeJson,
  deepFreeze,
  modelExecutionCertificationBasisSchema,
} from "@data-agent/contracts";
import type { z } from "zod";

const goalPreflightEvidenceSchema = modelExecutionCertificationBasisSchema.refine(
  (
    basis,
  ): basis is Extract<
    z.infer<typeof modelExecutionCertificationBasisSchema>,
    { kind: "GOAL_PREFLIGHT_ATTESTATION" }
  > => basis.kind === "GOAL_PREFLIGHT_ATTESTATION",
  "Goal preflight evidence 必须使用 GOAL_PREFLIGHT_ATTESTATION。",
);

export interface CommittedGoalPreflightEvidenceResolver {
  resolve_committed(input: {
    readonly goal_execution_id: string;
    readonly plan_commit: string;
  }): Promise<unknown | null>;
}

declare const authoritativeGoalPreflightEvidence: unique symbol;
const authoritativeGoalPreflightEvidenceValues = new WeakSet<object>();

export type AuthoritativeGoalPreflightEvidence = z.infer<typeof goalPreflightEvidenceSchema> & {
  readonly [authoritativeGoalPreflightEvidence]: true;
};

export async function authorizeGoalPreflightEvidence(
  input: unknown,
  resolver: CommittedGoalPreflightEvidenceResolver,
): Promise<AuthoritativeGoalPreflightEvidence> {
  if (!resolver || typeof resolver.resolve_committed !== "function") {
    throw new Error("Goal preflight evidence 必须由 package-private committed resolver 解析。");
  }
  const expected = goalPreflightEvidenceSchema.parse(input);
  const resolved = goalPreflightEvidenceSchema.parse(
    await resolver.resolve_committed({
      goal_execution_id: expected.goal_execution_id,
      plan_commit: expected.plan_commit,
    }),
  );
  if (canonicalizeJson(resolved) !== canonicalizeJson(expected)) {
    throw new Error(
      "Goal preflight plan/manifest/checkpoint/evidence 与 committed snapshot 不一致。",
    );
  }
  const evidence = deepFreeze(resolved);
  authoritativeGoalPreflightEvidenceValues.add(evidence);
  return evidence as AuthoritativeGoalPreflightEvidence;
}

export function isAuthoritativeGoalPreflightEvidence(
  input: unknown,
): input is AuthoritativeGoalPreflightEvidence {
  return (
    typeof input === "object" &&
    input !== null &&
    authoritativeGoalPreflightEvidenceValues.has(input)
  );
}
