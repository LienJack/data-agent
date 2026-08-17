import type { ArtifactReference } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { compileTeamContext, verifyCompiledTeamContext } from "../src/mastra/context-compiler.js";
import { AGENT_PROFILE_REVISIONS } from "../src/teams/index.js";
import { APP_SCOPE, ARTIFACT_REF, PARENT_TASK_ID, RUN_ID } from "./fixtures/team.js";

const POLICY_REF = {
  ...ARTIFACT_REF,
  artifact_id: "00000000-0000-4000-8000-000000000020",
  artifact_type: "PolicyReceipt",
  content_hash: `sha256:${"2".repeat(64)}`,
} as const satisfies ArtifactReference;

const profile = AGENT_PROFILE_REVISIONS.find(
  (entry) => entry.profile_id === "semantic-management-agent",
);

function input(maxContextBytes = 8_192) {
  if (!profile) throw new Error("missing profile fixture");
  return {
    schema_version: "team-context-build@2.0.0",
    epoch_id: "00000000-0000-4000-8000-000000000021",
    scope: APP_SCOPE,
    run_id: RUN_ID,
    task_id: PARENT_TASK_ID,
    profile_revision: profile,
    goal_revision: 3,
    task_revision: 5,
    event_watermark: 11,
    policy_ref: POLICY_REF,
    semantic_release_ref: null,
    max_context_bytes: maxContextBytes,
    candidates: [
      {
        candidate_id: "goal.current",
        context_kind: "GOAL",
        source_ref: ARTIFACT_REF,
        mandatory: true,
        media_type: "text/plain",
        content: "回答已授权的分析问题。",
        priority: 100,
      },
      {
        candidate_id: "policy.current",
        context_kind: "POLICY",
        source_ref: POLICY_REF,
        mandatory: true,
        media_type: "application/json",
        content: '{"classification":"INTERNAL"}',
        priority: 100,
      },
      {
        candidate_id: "question.current",
        context_kind: "QUESTION",
        source_ref: ARTIFACT_REF,
        mandatory: true,
        media_type: "text/plain",
        content: "本季度退款订单数是多少？",
        priority: 100,
      },
      {
        candidate_id: "mapping.orders",
        context_kind: "SCHEMA_MAPPING",
        source_ref: ARTIFACT_REF,
        mandatory: true,
        media_type: "application/json",
        content: '{"table":"orders"}',
        priority: 90,
      },
      {
        candidate_id: "evidence.optional",
        context_kind: "QUERY_EVIDENCE",
        source_ref: ARTIFACT_REF,
        mandatory: false,
        media_type: "text/plain",
        content: "x".repeat(4_096),
        priority: 1,
      },
    ],
  } as const;
}

describe("Team v2 context compiler", () => {
  it("is deterministic and keeps authority refs outside untrusted data", async () => {
    const first = await compileTeamContext(input());
    const second = await compileTeamContext(input());
    expect(first.manifest.build_signature).toBe(second.manifest.build_signature);
    expect(first.view).toEqual(second.view);
    expect(first.view.items.every((item) => item.trust === "UNTRUSTED_DATA")).toBe(true);
    expect(JSON.stringify(first)).not.toContain("raw_memory");
    expect(await verifyCompiledTeamContext(first, input())).toEqual(first);
  });

  it("records every omission and blocks acceptance when mandatory context cannot fit", async () => {
    const compiled = await compileTeamContext(input(2_500));
    expect(compiled.coverage.candidate_ids).toEqual([
      "evidence.optional",
      "goal.current",
      "mapping.orders",
      "policy.current",
      "question.current",
    ]);
    expect(compiled.coverage.omitted.map((entry) => entry.candidate_id)).toContain(
      "evidence.optional",
    );
    expect(compiled.coverage.acceptance_blocked).toBe(false);

    const mandatoryTooLarge = {
      ...input(2_500),
      candidates: input(2_500).candidates.map((candidate, index) =>
        index === 0 ? { ...candidate, content: "q".repeat(5_000) } : candidate,
      ),
    };
    const blocked = await compileTeamContext(mandatoryTooLarge);
    expect(blocked.coverage.acceptance_blocked).toBe(true);
  });

  it("rejects truth drift and cross-workspace candidates", async () => {
    const compiled = await compileTeamContext(input());
    await expect(
      verifyCompiledTeamContext(compiled, { ...input(), event_watermark: 12 }),
    ).rejects.toThrow("TEAM_CONTEXT_TRUTH_DRIFT");
    await expect(
      compileTeamContext({
        ...input(),
        candidates: [
          {
            ...input().candidates[0],
            source_ref: { ...ARTIFACT_REF, tenant_id: APP_SCOPE.app_id },
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("builds 100 bounded task projections and rejects a missing mandatory kind", async () => {
    const compiled = await Promise.all(
      Array.from({ length: 100 }, (_, index) => {
        const suffix = String(index + 100).padStart(12, "0");
        return compileTeamContext({
          ...input(65_536),
          epoch_id: `00000000-0000-4000-8000-${suffix}`,
          task_id: `00000000-0000-4001-8000-${suffix}`,
        });
      }),
    );
    expect(compiled).toHaveLength(100);
    expect(compiled.every((entry) => entry.view.byte_count <= 65_536)).toBe(true);
    expect(new Set(compiled.map((entry) => entry.manifest.build_signature)).size).toBe(100);

    await expect(
      compileTeamContext({
        ...input(),
        candidates: input().candidates.filter((candidate) => candidate.context_kind !== "POLICY"),
      }),
    ).rejects.toThrow("Mandatory context kind POLICY is missing");
  });
});
