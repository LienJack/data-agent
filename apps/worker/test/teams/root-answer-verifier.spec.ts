import {
  buildProductTeamArtifactDocument,
  type RootAgentDecisionCandidate,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createRootAnswerVerifier } from "../../src/teams/root-answer-verifier.js";

const id = (suffix: number) => `97000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

async function report() {
  return buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@1.0.0",
    artifact_ref: {
      artifact_id: id(10),
      artifact_type: "AnalysisReport",
      ...scope,
      run_id: id(3),
      revision: 1,
      content_hash: hash("0"),
    },
    profile_id: "semantic-management-agent",
    task_id: id(11),
    source_refs: [],
    projection: {
      kind: "REPORT",
      title: "冻结语义图关系证据",
      sections: [
        {
          heading: "关系",
          body_text: "[JOIN] orders -> customers",
          source_refs: [],
        },
      ],
    },
    committed_at: "2026-08-22T12:00:00.000Z",
  });
}

describe("Root answer verifier", () => {
  it("accepts general knowledge without requiring a Subagent", async () => {
    const verifier = createRootAnswerVerifier({
      artifacts: { resolveCommitted: async () => ({ ok: true, value: null }) },
    });
    const candidate: RootAgentDecisionCandidate = {
      schema_version: "root-agent-turn-candidate@1.0.0",
      kind: "FINAL_ANSWER",
      scope,
      run_id: id(3),
      catalog_snapshot_hash: hash("1"),
      sections: [
        {
          kind: "GENERAL_TEXT",
          text: "同比是与上年同一时期比较。",
          basis: "GENERAL_KNOWLEDGE",
          source_message_refs: [],
        },
      ],
      public_summary: "主 Agent 直接解释通用概念。",
    };
    await expect(
      verifier.verify({
        decision: candidate,
        visible_message_refs: [],
        accepted_artifact_refs: [],
      }),
    ).resolves.toMatchObject({
      status: "ACCEPTED",
      rendered_text: "同比是与上年同一时期比较。",
    });
  });

  it("requires the exact accepted Artifact before rendering workspace facts", async () => {
    const document = await report();
    const verifier = createRootAnswerVerifier({
      artifacts: { resolveCommitted: async () => ({ ok: true, value: document }) },
    });
    const candidate: RootAgentDecisionCandidate = {
      schema_version: "root-agent-turn-candidate@1.0.0",
      kind: "FINAL_ANSWER",
      scope,
      run_id: id(3),
      catalog_snapshot_hash: hash("1"),
      sections: [
        {
          kind: "ARTIFACT_FACTS",
          artifact_ref: document.artifact_ref,
          fact_selectors: ["projection.sections"],
        },
      ],
      public_summary: "基于已验收语义图证据回答。",
    };
    await expect(
      verifier.verify({
        decision: candidate,
        visible_message_refs: [],
        accepted_artifact_refs: [],
      }),
    ).resolves.toMatchObject({
      status: "EVIDENCE_REQUIRED",
      reason_code: "ROOT_ANSWER_ARTIFACT_NOT_ACCEPTED",
    });
    await expect(
      verifier.verify({
        decision: candidate,
        visible_message_refs: [],
        accepted_artifact_refs: [document.artifact_ref],
      }),
    ).resolves.toMatchObject({
      status: "ACCEPTED",
      rendered_text: "[JOIN] orders -> customers",
    });
  });
});
