import { buildTeamTaskV2, getAgentProfileRevision } from "@data-agent/agent-runtime";
import {
  type AgentProductProfileRegistryItemV2,
  buildAgentProductProfileRevisionV2,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { buildBuiltinTeamMaterialization } from "../../src/teams/builtin-profile-assets.js";
import { createMastraProfileComposition } from "../../src/teams/mastra-profile-composition.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const profileIds = [
  "governed-analysis-agent",
  "governed-text2sql-agent",
  "report-writing-agent",
  "semantic-management-agent",
] as const;

function resources(offset: number) {
  return Object.fromEntries(
    profileIds.map((profileId, index) => [
      profileId,
      {
        resource_id: id(offset + index),
        resource_revision: 1,
        resource_hash: hash(String((offset + index) % 10)),
      },
    ]),
  ) as Record<
    (typeof profileIds)[number],
    { resource_id: string; resource_revision: number; resource_hash: string }
  >;
}

async function items(): Promise<AgentProductProfileRegistryItemV2[]> {
  const materialized = await buildBuiltinTeamMaterialization({
    scope,
    model_profile_refs: resources(10),
    context_policy_refs: resources(20),
    execution_safety_policy_refs: resources(30),
  });
  return materialized.profile_revisions.map((revision) => ({
    schema_version: "agent-product-profile-registry-item@2.0.0",
    revision,
    head: {
      schema_version: "agent-product-profile-head@2.0.0",
      scope,
      profile_id: revision.profile_id,
      active_revision: revision.revision,
      active_revision_hash: revision.revision_hash,
      lifecycle: "ENABLED",
      version: 1,
      updated_at: "2026-08-18T12:00:00.000Z",
    },
  }));
}

describe("Mastra specialist profile composition", () => {
  it("executes each specialist with only its frozen direct Tool allowlist", async () => {
    const profiles = await items();
    const invoked = new Map<string, string[]>();
    const displayEvents: unknown[] = [];
    const registry = await createMastraProfileComposition({
      profiles,
      now: () => 100,
      visibility: {
        async emit(input) {
          displayEvents.push(input);
          return { ok: true, value: { sequence: displayEvents.length } };
        },
      },
      tools: {
        async invoke({ task, tool_id }) {
          invoked.set(task.profile_id, [...(invoked.get(task.profile_id) ?? []), tool_id]);
          const artifactType = task.acceptance.required_artifact_types.at(0);
          if (!artifactType) throw new Error("missing required artifact type");
          const output = {
            artifact_id: id(
              80 + profileIds.indexOf(task.profile_id as (typeof profileIds)[number]),
            ),
            artifact_type: artifactType,
            ...scope,
            run_id: task.run_id,
            revision: 1,
            content_hash: hash("f"),
          };
          return tool_id === "sql.sandbox.execute"
            ? {
                output_ref: output,
                public_artifact_refs: [
                  output,
                  {
                    artifact_id: id(89),
                    artifact_type: "ArtifactWorkspaceDocument",
                    ...scope,
                    run_id: task.run_id,
                    revision: 1,
                    content_hash: hash("c"),
                  },
                ],
              }
            : output;
        },
      },
    });

    for (const [index, profileId] of profileIds.entries()) {
      const runtime = getAgentProfileRevision(profileId);
      const task = buildTeamTaskV2({
        schema_version: "agent-team-task@2.0.0",
        task_id: id(40 + index),
        parent_task_id: id(39),
        parent_handoff_id: id(50 + index),
        depth: 1,
        scope,
        run_id: id(60),
        profile_id: profileId,
        profile_revision: runtime.revision,
        profile_hash: runtime.profile_hash,
        task_revision: 1,
        goal_revision: 1,
        attempt_id: id(70 + index),
        worker_fence: 1,
        artifact_refs: [],
        context_epoch_ref: null,
        bounds: {
          max_context_bytes: 65_536,
          max_input_tokens: 8_192,
          max_output_tokens: 2_048,
          max_tool_calls: 8,
          timeout_ms: 60_000,
        },
        acceptance: {
          required_artifact_types: runtime.expected_output_artifact_types,
          require_all_verifier_dimensions: true,
        },
      });
      await expect(
        registry.execute(task, { epoch_id: id(90 + index), build_signature: hash("e") }),
      ).resolves.toMatchObject({ status: "COMPLETED" });
      expect(invoked.get(profileId)).toEqual([...runtime.direct_tool_allowlist].sort());
    }
    expect(
      displayEvents.filter((event) => (event as { kind: string }).kind === "tool_started"),
    ).toHaveLength(7);
    expect(
      displayEvents.filter((event) => (event as { kind: string }).kind === "tool_completed"),
    ).toHaveLength(7);
    expect(displayEvents).toContainEqual(
      expect.objectContaining({
        kind: "tool_completed",
        tool_name: "sql.sandbox.execute",
        artifact_refs: [
          expect.objectContaining({ artifact_type: "QueryEvidence" }),
          expect.objectContaining({ artifact_type: "ArtifactWorkspaceDocument" }),
        ],
      }),
    );
    expect(JSON.stringify(displayEvents)).not.toMatch(/raw|prompt|reasoning_content/i);
  });

  it("rejects a product Profile that expands its U19 runtime direct tools", async () => {
    const profiles = await items();
    const original = profiles.at(0);
    if (!original) throw new Error("missing product profile fixture");
    const { revision_hash: _revisionHash, ...revisionDraft } = original.revision;
    const expanded = await buildAgentProductProfileRevisionV2({
      ...revisionDraft,
      direct_tool_allowlist: [
        ...original.revision.direct_tool_allowlist,
        "semantic.candidate.write",
      ].sort(),
    });
    await expect(
      createMastraProfileComposition({
        profiles: [{ ...original, revision: expanded }, ...profiles.slice(1)],
        tools: { invoke: async () => null },
        visibility: {
          emit: async () => ({ ok: true, value: { sequence: 1 } }),
        },
      }),
    ).rejects.toThrow("TEAM_PRODUCT_PROFILE_NOT_CURRENT");
  });

  it("does not invoke a domain Tool when its public start event cannot be persisted", async () => {
    const profiles = await items();
    let domainCalls = 0;
    const registry = await createMastraProfileComposition({
      profiles,
      tools: {
        invoke: async () => {
          domainCalls += 1;
          return null;
        },
      },
      visibility: {
        emit: async () => ({
          ok: false,
          error: { code: "RUN_EVENT_WRITE_FAILED", message: "failed", retryable: false },
        }),
      },
    });
    const profileId = profileIds[0];
    const runtime = getAgentProfileRevision(profileId);
    const task = buildTeamTaskV2({
      schema_version: "agent-team-task@2.0.0",
      task_id: id(140),
      parent_task_id: id(139),
      parent_handoff_id: id(150),
      depth: 1,
      scope,
      run_id: id(160),
      profile_id: profileId,
      profile_revision: runtime.revision,
      profile_hash: runtime.profile_hash,
      task_revision: 1,
      goal_revision: 1,
      attempt_id: id(170),
      worker_fence: 1,
      artifact_refs: [],
      context_epoch_ref: null,
      bounds: {
        max_context_bytes: 65_536,
        max_input_tokens: 8_192,
        max_output_tokens: 2_048,
        max_tool_calls: 8,
        timeout_ms: 60_000,
      },
      acceptance: {
        required_artifact_types: runtime.expected_output_artifact_types,
        require_all_verifier_dimensions: true,
      },
    });

    await expect(
      registry.execute(task, { epoch_id: id(190), build_signature: hash("e") }),
    ).rejects.toThrow("RUN_EVENT_WRITE_FAILED");
    expect(domainCalls).toBe(0);
  });
});
