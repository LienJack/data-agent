import type { McpServerRegistryItem, SkillRegistryItem } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExtensionInventory } from "../src/components/settings/extensions-panel";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

const mcpItem = {
  schema_version: "mcp-server-registry-item@1.0.0",
  revision: {
    schema_version: "mcp-server-revision@1.0.0",
    scope,
    server_id: id(3),
    revision: 2,
    endpoint: "https://mcp.example.test/v1",
    secret_ref_id: null,
    trust_class: "EXTERNAL_REVIEWED",
    approval_status: "APPROVED",
    audience: "PRIVATE",
    manifest_version: "semantic-mcp@2",
    tools: [
      {
        tool_id: "query",
        name: "Query",
        description: "Governed query.",
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
    policy_revision: 4,
    revision_hash: hash("3"),
  },
  head: {
    schema_version: "mcp-server-head@1.0.0",
    scope,
    server_id: id(3),
    active_revision: 2,
    active_revision_hash: hash("3"),
    lifecycle: "ENABLED",
    version: 5,
    updated_at: "2026-08-17T00:00:00.000Z",
  },
} satisfies McpServerRegistryItem;

const skillItem = {
  schema_version: "skill-registry-item@1.0.0",
  revision: {
    schema_version: "skill-revision@1.0.0",
    scope,
    skill_id: id(4),
    revision: 1,
    name: "Commerce analyst",
    source_url: "https://skills.example.test/commerce.json",
    package_hash: hash("4"),
    dependency_lock_hash: hash("5"),
    signer_id: id(6),
    signature_hash: hash("6"),
    publisher_trust: "TRUSTED_PUBLISHER",
    approval_status: "QUARANTINED",
    capabilities: ["semantic.read"],
    default_resources: [],
    install_scripts: [],
    revision_hash: hash("7"),
  },
  head: {
    schema_version: "skill-head@1.0.0",
    scope,
    skill_id: id(4),
    active_revision: 1,
    active_revision_hash: hash("7"),
    lifecycle: "QUARANTINED",
    signer_revocation_version: 0,
    version: 1,
    updated_at: "2026-08-17T00:00:00.000Z",
  },
} satisfies SkillRegistryItem;

describe("Extensions inventory", () => {
  it("shows immutable revision identity and admin Head controls", () => {
    const html = renderToStaticMarkup(
      <ExtensionInventory kind="mcp" mcpItems={[mcpItem]} skillItems={[]} canManage busy={false} />,
    );
    expect(html).toContain("semantic-mcp@2");
    expect(html).toContain("ENABLED");
    expect(html).toContain("REV 2");
    expect(html).toContain("新 Revision");
    expect(html).toContain("停用");
  });

  it("keeps read-only viewers informed without mutation controls", () => {
    const html = renderToStaticMarkup(
      <ExtensionInventory
        kind="skill"
        mcpItems={[]}
        skillItems={[skillItem]}
        canManage={false}
        busy={false}
      />,
    );
    expect(html).toContain("Commerce analyst");
    expect(html).toContain("QUARANTINED");
    expect(html).not.toContain("新 Revision");
    expect(html).not.toContain("启用");
  });
});
