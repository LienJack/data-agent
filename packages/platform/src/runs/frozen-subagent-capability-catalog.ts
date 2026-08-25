import { createHash } from "node:crypto";
import {
  type AgentProductProfileRegistryItemV2,
  buildSubagentCapabilityCatalogSnapshot,
  projectSubagentCapabilityCatalogItem,
} from "@data-agent/contracts/agents";
import type { AppScope } from "@data-agent/contracts/common";

function deterministicUuid(material: string): string {
  const bytes = createHash("sha256")
    .update(`data-agent/frozen-subagent-catalog@1\0${material}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function freezeSubagentCapabilityCatalog(input: {
  readonly run_id: string;
  readonly scope: AppScope;
  readonly principal_id: string;
  readonly enabled_profiles: readonly AgentProductProfileRegistryItemV2[];
  readonly policy_version: string;
}) {
  const profiles = [...input.enabled_profiles].sort((left, right) =>
    left.revision.profile_id < right.revision.profile_id
      ? -1
      : left.revision.profile_id > right.revision.profile_id
        ? 1
        : 0,
  );
  const items = await Promise.all(profiles.map(projectSubagentCapabilityCatalogItem));
  return buildSubagentCapabilityCatalogSnapshot({
    schema_version: "subagent-capability-catalog-snapshot@1.0.0",
    catalog_id: deterministicUuid(`${input.run_id}:subagent-capability-catalog`),
    scope: input.scope,
    run_id: input.run_id,
    principal_id: input.principal_id,
    policy_version: input.policy_version,
    items,
  });
}
