import { describe, expect, it } from "vitest";
import {
  actionsForWorkspaceRole,
  buildMcpServerRevision,
  buildSkillRevision,
  buildToolEffectIntent,
  buildToolEffectTransition,
  mcpServerRegistryItemSchema,
  verifyMcpServerRevision,
  verifySkillRevision,
  verifyToolEffectIntent,
} from "../src/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

describe("Extension registry contracts", () => {
  it("represents a mutable Head beside the exact immutable MCP Revision", async () => {
    const revision = await buildMcpServerRevision({
      schema_version: "mcp-server-revision@1.0.0",
      scope,
      server_id: id(90),
      revision: 2,
      endpoint: "https://mcp.example.test/v1",
      secret_ref_id: null,
      trust_class: "INTERNAL",
      approval_status: "APPROVED",
      audience: "WORKSPACE",
      manifest_version: "semantic@2",
      tools: [
        {
          tool_id: "list_metrics",
          name: "List metrics",
          description: "List governed metrics.",
          input_schema_hash: hash("1"),
          output_schema_hash: hash("2"),
          effect_semantics: "READ_ONLY",
          remote_idempotency_key_field: null,
          outcome_status_tool_id: null,
          required_capabilities: ["semantic.read"],
          max_timeout_ms: 10_000,
          max_response_bytes: 1_000_000,
        },
      ],
      policy_revision: 3,
    });
    const item = mcpServerRegistryItemSchema.parse({
      schema_version: "mcp-server-registry-item@1.0.0",
      revision,
      head: {
        schema_version: "mcp-server-head@1.0.0",
        scope,
        server_id: revision.server_id,
        active_revision: revision.revision,
        active_revision_hash: revision.revision_hash,
        lifecycle: "ENABLED",
        version: 4,
        updated_at: "2026-08-17T00:00:00.000Z",
      },
    });
    expect(item.head).toMatchObject({ active_revision: 2, version: 4 });
  });

  it("grants EXTENSION_MANAGE only to workspace/system admins", () => {
    expect(actionsForWorkspaceRole("WORKSPACE_ADMIN", "USER")).toContain("EXTENSION_MANAGE");
    expect(actionsForWorkspaceRole("ANALYST", "USER")).not.toContain("EXTENSION_MANAGE");
    expect(actionsForWorkspaceRole("VIEWER", "USER")).not.toContain("EXTENSION_MANAGE");
    expect(actionsForWorkspaceRole("VIEWER", "SUPER_ADMIN")).toContain("EXTENSION_MANAGE");
  });

  it("builds immutable MCP revisions and rejects unsafe endpoint/effect combinations", async () => {
    const revision = await buildMcpServerRevision({
      schema_version: "mcp-server-revision@1.0.0",
      scope,
      server_id: id(3),
      revision: 1,
      endpoint: "https://mcp.example.test/v1",
      secret_ref_id: id(4),
      trust_class: "EXTERNAL_REVIEWED",
      approval_status: "APPROVED",
      audience: "PRIVATE",
      manifest_version: "commerce-mcp@1",
      tools: [
        {
          tool_id: "query_status",
          name: "Query status",
          description: "Read the status of an idempotent query.",
          input_schema_hash: hash("1"),
          output_schema_hash: hash("2"),
          effect_semantics: "READ_ONLY",
          remote_idempotency_key_field: null,
          outcome_status_tool_id: null,
          required_capabilities: ["query.read"],
          max_timeout_ms: 10_000,
          max_response_bytes: 1_000_000,
        },
      ],
      policy_revision: 1,
    });
    await expect(verifyMcpServerRevision(revision)).resolves.toEqual(revision);
    await expect(
      verifyMcpServerRevision({ ...revision, endpoint: "https://other.example.test/v1" }),
    ).rejects.toThrow("MCP_SERVER_REVISION_HASH_MISMATCH");
    await expect(
      buildMcpServerRevision({
        ...revision,
        revision_hash: undefined,
        endpoint: "http://127.0.0.1:3000/?token=secret",
      }),
    ).rejects.toThrow();
  });

  it("builds signed Skill revisions without install scripts and detects digest drift", async () => {
    const revision = await buildSkillRevision({
      schema_version: "skill-revision@1.0.0",
      scope,
      skill_id: id(5),
      revision: 1,
      name: "Commerce Analyst",
      source_url: "https://skills.example.test/commerce/v1.json",
      package_hash: hash("3"),
      dependency_lock_hash: hash("4"),
      signer_id: id(6),
      signature_hash: hash("5"),
      publisher_trust: "TRUSTED_PUBLISHER",
      approval_status: "APPROVED",
      capabilities: ["semantic.read", "sql.query"],
      default_resources: [],
      install_scripts: [],
    });
    await expect(verifySkillRevision(revision)).resolves.toEqual(revision);
    await expect(
      verifySkillRevision({ ...revision, dependency_lock_hash: hash("f") }),
    ).rejects.toThrow("SKILL_REVISION_HASH_MISMATCH");
    const { revision_hash: _revisionHash, ...revisionDraft } = revision;
    expect(
      await buildSkillRevision({
        ...revisionDraft,
        install_scripts: [],
      }),
    ).toEqual(revision);
  });

  it("enforces Tool Effect intent and unknown reconciliation truth tables", async () => {
    const intent = await buildToolEffectIntent({
      schema_version: "tool-effect-intent@1.0.0",
      effect_id: id(10),
      scope,
      run_id: id(11),
      attempt_id: id(12),
      worker_fence: 3,
      task_capability_hash: hash("6"),
      projection_receipt_ref: {
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        run_id: id(11),
        artifact_id: id(13),
        artifact_type: "AgentDataProjectionReceipt",
        revision: 1,
        content_hash: hash("7"),
      },
      server_id: id(3),
      server_revision: 1,
      server_revision_hash: hash("8"),
      tool_id: "submit_query",
      effect_semantics: "IDEMPOTENT_REQUEST",
      remote_idempotency_key: "tool:query:001",
      request_payload_hash: hash("9"),
      policy_revision: 1,
    });
    await expect(verifyToolEffectIntent(intent)).resolves.toEqual(intent);
    await expect(
      buildToolEffectTransition({
        schema_version: "tool-effect-transition@1.0.0",
        transition_id: id(14),
        effect_id: intent.effect_id,
        expected_state: "DISPATCH_MARKED",
        target_state: "TOOL_OUTCOME_UNKNOWN",
        dispatch_hash: hash("a"),
        response_hash: null,
        delivery_certainty: "DISPATCHED_UNKNOWN",
        reason_code: "TOOL_OUTCOME_UNKNOWN",
        reconciliation_of: null,
      }),
    ).resolves.toMatchObject({ target_state: "TOOL_OUTCOME_UNKNOWN" });
    await expect(
      buildToolEffectTransition({
        schema_version: "tool-effect-transition@1.0.0",
        transition_id: id(15),
        effect_id: intent.effect_id,
        expected_state: "TOOL_OUTCOME_UNKNOWN",
        target_state: "COMPLETED",
        dispatch_hash: hash("a"),
        response_hash: hash("b"),
        delivery_certainty: "DISPATCHED_KNOWN",
        reason_code: "TOOL_COMPLETED",
        reconciliation_of: null,
      }),
    ).rejects.toThrow("Unknown reconciliation parent mismatch");
  });
});
