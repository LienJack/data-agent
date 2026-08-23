import { z } from "zod";
import { deepFreeze } from "../common/index.js";

export const PLATFORM_CAPABILITY_IDS = [
  "M01",
  "M02",
  "M03",
  "M04",
  "M05",
  "M06",
  "M07",
  "M08",
  "M09",
  "M10",
  "M11",
  "M12",
  "M13",
  "M14",
  "M15",
  "M16",
  "M17",
  "M18",
  "S01",
  "S02",
  "S03",
  "S04",
  "S05",
  "S06",
  "S07",
  "S08",
  "S09",
  "S10",
  "S11",
  "S12",
  "A01",
  "A02",
  "A03",
  "A04",
  "A05",
  "A06",
  "A07",
  "A08",
  "A09",
  "A10",
  "R01",
  "R02",
  "R03",
  "R04",
  "R05",
  "R06",
  "R07",
  "R08",
  "R09",
  "R10",
  "T01",
  "T02",
  "T03",
  "T04",
  "T05",
  "T06",
  "T07",
  "T08",
] as const;

export const platformCapabilityIdSchema = z.enum(PLATFORM_CAPABILITY_IDS);
export const platformCapabilityOwnerSchema = z.enum([
  "PLATFORM",
  "SEMANTIC",
  "AGENT_RUNTIME",
  "EVALS",
  "WEB",
  "WORKER",
]);
export const platformCapabilityAuthoritySchema = z.enum([
  "POSTGRESQL",
  "ARTIFACT_AUTHORITY",
  "PUBLIC_EVENT_LEDGER",
  "SIGNED_MANIFEST",
  "DETERMINISTIC_ORACLE",
]);
// This manifest freezes capability definitions, not runtime delivery claims.
// Later units project delivery only from committed Receipt authority.
export const platformCapabilityStatusSchema = z.literal("PLANNED");
export const platformUnitIdSchema = z.enum([
  "U1",
  "U2",
  "U3",
  "U4",
  "U5",
  "U6",
  "U7",
  "U8",
  "U9",
  "U10",
  "U11",
  "U12",
  "U13",
  "U14",
  "U15",
  "U16",
  "U17",
  "U18",
  "U19",
  "U20",
]);

export const capabilityEvidenceKindSchema = z.enum([
  "PROVIDER_INVOCATION",
  "USAGE_RECEIPT",
  "CONTEXT_CAPACITY",
  "EXECUTION_RECOVERY",
  "AUTHORITY_RECEIPT",
  "ARTIFACT_PROOF",
  "AUDIT_EVENT",
  "DETERMINISTIC_ORACLE",
]);

export const platformCapabilityDescriptorSchema = z
  .strictObject({
    capability_id: platformCapabilityIdSchema,
    owner: platformCapabilityOwnerSchema,
    authority: platformCapabilityAuthoritySchema,
    status: platformCapabilityStatusSchema,
    primary_unit: platformUnitIdSchema,
    depends_on: z.array(platformCapabilityIdSchema).max(57),
    evidence_kinds: z.array(capabilityEvidenceKindSchema).min(1).max(8),
  })
  .superRefine((descriptor, ctx) => {
    if (new Set(descriptor.evidence_kinds).size !== descriptor.evidence_kinds.length) {
      ctx.addIssue({
        code: "custom",
        message: "Capability evidence kind 必须唯一。",
        path: ["evidence_kinds"],
      });
    }
  });

export const PLATFORM_UNIT_DEPENDENCY_DAG = deepFreeze([
  ["U1", "U2"],
  ["U2", "U3"],
  ["U1", "U4"],
  ["U4", "U5"],
  ["U2", "U6"],
  ["U10", "U6"],
  ["U2", "U7"],
  ["U2", "U8"],
  ["U19", "U8"],
  ["U7", "U9"],
  ["U8", "U9"],
  ["U2", "U10"],
  ["U19", "U10"],
  ["U5", "U11"],
  ["U10", "U11"],
  ["U15", "U11"],
  ["U2", "U12"],
  ["U5", "U12"],
  ["U11", "U12"],
  ["U15", "U12"],
  ["U12", "U13"],
  ["U2", "U14"],
  ["U10", "U14"],
  ["U12", "U14"],
  ["U13", "U14"],
  ["U6", "U15"],
  ["U10", "U15"],
  ["U10", "U16"],
  ["U2", "U19"],
  ["U3", "U19"],
  ["U5", "U19"],
  ["U7", "U19"],
  ["U8", "U20"],
  ["U9", "U20"],
  ["U10", "U20"],
  ["U11", "U20"],
  ["U12", "U20"],
  ["U13", "U20"],
  ["U14", "U20"],
  ["U15", "U20"],
  ["U19", "U20"],
  ["U3", "U17"],
  ["U5", "U17"],
  ["U7", "U17"],
  ["U9", "U17"],
  ["U12", "U17"],
  ["U14", "U17"],
  ["U15", "U17"],
  ["U16", "U17"],
  ["U20", "U17"],
  ["U3", "U18"],
  ["U5", "U18"],
  ["U7", "U18"],
  ["U8", "U18"],
  ["U9", "U18"],
  ["U10", "U18"],
  ["U11", "U18"],
  ["U12", "U18"],
  ["U13", "U18"],
  ["U14", "U18"],
  ["U15", "U18"],
  ["U16", "U18"],
  ["U17", "U18"],
  ["U20", "U18"],
] as const);

function buildUnitAncestors() {
  const direct = new Map<string, Set<string>>();
  for (const [prerequisite, dependent] of PLATFORM_UNIT_DEPENDENCY_DAG) {
    const prerequisites = direct.get(dependent) ?? new Set<string>();
    prerequisites.add(prerequisite);
    direct.set(dependent, prerequisites);
  }
  const ancestors = new Map<string, Set<string>>();
  function visit(unit: string, active = new Set<string>()): Set<string> {
    const cached = ancestors.get(unit);
    if (cached) return cached;
    if (active.has(unit)) throw new Error(`Frozen U-ID DAG contains a cycle at ${unit}`);
    const nextActive = new Set(active).add(unit);
    const result = new Set<string>();
    for (const prerequisite of direct.get(unit) ?? []) {
      result.add(prerequisite);
      for (const ancestor of visit(prerequisite, nextActive)) result.add(ancestor);
    }
    ancestors.set(unit, result);
    return result;
  }
  for (const unit of platformUnitIdSchema.options) visit(unit);
  return ancestors;
}

const unitAncestors = buildUnitAncestors();

function findCapabilityCycle(
  descriptors: readonly z.infer<typeof platformCapabilityDescriptorSchema>[],
): readonly string[] | null {
  const dependencies = new Map<string, readonly string[]>(
    descriptors.map((descriptor) => [descriptor.capability_id, descriptor.depends_on] as const),
  );
  const visited = new Set<string>();
  const active = new Set<string>();
  const path: string[] = [];

  function visit(capabilityId: string): readonly string[] | null {
    if (active.has(capabilityId)) {
      const start = path.indexOf(capabilityId);
      return [...path.slice(start), capabilityId];
    }
    if (visited.has(capabilityId)) return null;
    active.add(capabilityId);
    path.push(capabilityId);
    for (const dependency of dependencies.get(capabilityId) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    path.pop();
    active.delete(capabilityId);
    visited.add(capabilityId);
    return null;
  }

  for (const capabilityId of dependencies.keys()) {
    const cycle = visit(capabilityId);
    if (cycle) return cycle;
  }
  return null;
}

const expectedCapabilityIds = new Set<string>(PLATFORM_CAPABILITY_IDS);

const platformCapabilityManifestStructureSchema = z
  .array(platformCapabilityDescriptorSchema)
  .length(PLATFORM_CAPABILITY_IDS.length)
  .superRefine((descriptors, ctx) => {
    const seen = new Set<string>();
    const descriptorsById = new Map(descriptors.map((item) => [item.capability_id, item] as const));
    for (const [index, descriptor] of descriptors.entries()) {
      if (seen.has(descriptor.capability_id)) {
        ctx.addIssue({
          code: "custom",
          message: `Capability ID 重复: ${descriptor.capability_id}`,
          path: [index, "capability_id"],
        });
      }
      seen.add(descriptor.capability_id);

      const dependencySet = new Set(descriptor.depends_on);
      if (dependencySet.size !== descriptor.depends_on.length) {
        ctx.addIssue({
          code: "custom",
          message: `Capability 依赖重复: ${descriptor.capability_id}`,
          path: [index, "depends_on"],
        });
      }
      for (const dependency of descriptor.depends_on) {
        if (!expectedCapabilityIds.has(dependency)) {
          ctx.addIssue({
            code: "custom",
            message: `Capability 依赖目标不存在: ${dependency}`,
            path: [index, "depends_on"],
          });
        }
        const dependencyDescriptor = descriptorsById.get(dependency);
        if (
          dependencyDescriptor &&
          dependencyDescriptor.primary_unit !== descriptor.primary_unit &&
          !unitAncestors.get(descriptor.primary_unit)?.has(dependencyDescriptor.primary_unit)
        ) {
          ctx.addIssue({
            code: "custom",
            message: `Capability 依赖与冻结 U-ID DAG 逆向: ${descriptor.capability_id}(${descriptor.primary_unit}) -> ${dependency}(${dependencyDescriptor.primary_unit})`,
            path: [index, "depends_on"],
          });
        }
      }
    }
    for (const expected of PLATFORM_CAPABILITY_IDS) {
      if (!seen.has(expected)) {
        ctx.addIssue({ code: "custom", message: `Capability ID 缺失: ${expected}` });
      }
    }
    const cycle = findCapabilityCycle(descriptors);
    if (cycle) {
      ctx.addIssue({
        code: "custom",
        message: `Capability 依赖存在环: ${cycle.join(" -> ")}`,
      });
    }
  });

type CapabilityId = z.infer<typeof platformCapabilityIdSchema>;
type CapabilityOwner = z.infer<typeof platformCapabilityOwnerSchema>;
type CapabilityAuthority = z.infer<typeof platformCapabilityAuthoritySchema>;
type UnitId = z.infer<typeof platformUnitIdSchema>;
type EvidenceKind = z.infer<typeof capabilityEvidenceKindSchema>;

function capability(
  capability_id: CapabilityId,
  owner: CapabilityOwner,
  authority: CapabilityAuthority,
  primary_unit: UnitId,
  evidence_kinds: EvidenceKind | readonly EvidenceKind[],
  depends_on: readonly CapabilityId[] = [],
) {
  return {
    capability_id,
    owner,
    authority,
    status: "PLANNED" as const,
    primary_unit,
    depends_on: [...depends_on],
    evidence_kinds: Array.isArray(evidence_kinds) ? [...evidence_kinds] : [evidence_kinds],
  };
}

const manifestInput = [
  capability("M01", "PLATFORM", "POSTGRESQL", "U2", "AUTHORITY_RECEIPT"),
  capability(
    "M02",
    "PLATFORM",
    "ARTIFACT_AUTHORITY",
    "U3",
    ["PROVIDER_INVOCATION", "USAGE_RECEIPT"],
    ["M01"],
  ),
  capability("M03", "PLATFORM", "POSTGRESQL", "U6", "AUDIT_EVENT"),
  capability("M04", "WEB", "ARTIFACT_AUTHORITY", "U7", "ARTIFACT_PROOF"),
  capability("M05", "WEB", "PUBLIC_EVENT_LEDGER", "U9", "AUDIT_EVENT"),
  capability("M06", "WORKER", "PUBLIC_EVENT_LEDGER", "U8", "EXECUTION_RECOVERY"),
  capability("M07", "WORKER", "POSTGRESQL", "U8", "EXECUTION_RECOVERY", ["M06"]),
  capability("M08", "WORKER", "POSTGRESQL", "U8", "AUTHORITY_RECEIPT", ["M01"]),
  capability("M09", "WORKER", "PUBLIC_EVENT_LEDGER", "U8", "EXECUTION_RECOVERY", ["M06"]),
  capability("M10", "PLATFORM", "ARTIFACT_AUTHORITY", "U9", "ARTIFACT_PROOF", ["M05"]),
  capability("M11", "PLATFORM", "ARTIFACT_AUTHORITY", "U15", "ARTIFACT_PROOF"),
  capability("M12", "PLATFORM", "SIGNED_MANIFEST", "U14", "AUDIT_EVENT"),
  capability("M13", "PLATFORM", "SIGNED_MANIFEST", "U14", "AUTHORITY_RECEIPT", ["M12"]),
  capability("M14", "WEB", "SIGNED_MANIFEST", "U16", "AUTHORITY_RECEIPT"),
  capability("M15", "PLATFORM", "POSTGRESQL", "U16", "AUDIT_EVENT", ["M14"]),
  capability("M16", "PLATFORM", "POSTGRESQL", "U10", "EXECUTION_RECOVERY"),
  capability("M17", "PLATFORM", "POSTGRESQL", "U10", "AUTHORITY_RECEIPT", ["M01"]),
  capability("M18", "WEB", "ARTIFACT_AUTHORITY", "U17", "ARTIFACT_PROOF"),
  capability("S01", "SEMANTIC", "POSTGRESQL", "U4", "AUTHORITY_RECEIPT"),
  capability("S02", "SEMANTIC", "POSTGRESQL", "U4", "AUTHORITY_RECEIPT", ["S01"]),
  capability("S03", "SEMANTIC", "ARTIFACT_AUTHORITY", "U4", "ARTIFACT_PROOF", ["S02"]),
  capability("S04", "SEMANTIC", "ARTIFACT_AUTHORITY", "U4", "ARTIFACT_PROOF", ["S02"]),
  capability("S05", "SEMANTIC", "ARTIFACT_AUTHORITY", "U4", "ARTIFACT_PROOF", ["S03"]),
  capability("S06", "SEMANTIC", "ARTIFACT_AUTHORITY", "U4", "ARTIFACT_PROOF", ["S03"]),
  capability("S07", "SEMANTIC", "ARTIFACT_AUTHORITY", "U4", "ARTIFACT_PROOF", ["S04"]),
  capability("S08", "SEMANTIC", "POSTGRESQL", "U4", "AUTHORITY_RECEIPT", ["S04"]),
  capability("S09", "SEMANTIC", "ARTIFACT_AUTHORITY", "U4", "ARTIFACT_PROOF", ["S08"]),
  capability("S10", "SEMANTIC", "ARTIFACT_AUTHORITY", "U4", "ARTIFACT_PROOF", ["S09"]),
  capability("S11", "SEMANTIC", "ARTIFACT_AUTHORITY", "U4", "ARTIFACT_PROOF", ["S05", "S08"]),
  capability("S12", "SEMANTIC", "POSTGRESQL", "U5", "AUTHORITY_RECEIPT", ["S11"]),
  capability("A01", "SEMANTIC", "ARTIFACT_AUTHORITY", "U11", "ARTIFACT_PROOF", ["S03"]),
  capability("A02", "SEMANTIC", "ARTIFACT_AUTHORITY", "U11", "ARTIFACT_PROOF", ["S11"]),
  capability("A03", "SEMANTIC", "ARTIFACT_AUTHORITY", "U11", "ARTIFACT_PROOF", ["A01"]),
  capability("A04", "SEMANTIC", "POSTGRESQL", "U11", "AUTHORITY_RECEIPT", ["A01"]),
  capability("A05", "SEMANTIC", "POSTGRESQL", "U5", "AUTHORITY_RECEIPT"),
  capability("A06", "SEMANTIC", "DETERMINISTIC_ORACLE", "U5", "DETERMINISTIC_ORACLE", ["A05"]),
  capability("A07", "SEMANTIC", "ARTIFACT_AUTHORITY", "U11", "ARTIFACT_PROOF", ["A04"]),
  capability("A08", "SEMANTIC", "ARTIFACT_AUTHORITY", "U11", "ARTIFACT_PROOF", ["A07"]),
  capability("A09", "SEMANTIC", "ARTIFACT_AUTHORITY", "U11", "ARTIFACT_PROOF", ["A08"]),
  capability("A10", "SEMANTIC", "ARTIFACT_AUTHORITY", "U5", "ARTIFACT_PROOF", ["A05"]),
  capability("R01", "AGENT_RUNTIME", "SIGNED_MANIFEST", "U12", "CONTEXT_CAPACITY", ["M01", "S12"]),
  capability("R02", "SEMANTIC", "POSTGRESQL", "U12", "AUTHORITY_RECEIPT", ["S12"]),
  capability("R03", "AGENT_RUNTIME", "SIGNED_MANIFEST", "U13", "ARTIFACT_PROOF", ["R02"]),
  capability("R04", "SEMANTIC", "POSTGRESQL", "U13", "EXECUTION_RECOVERY", ["R03"]),
  capability("R05", "AGENT_RUNTIME", "SIGNED_MANIFEST", "U12", "AUTHORITY_RECEIPT", ["R01"]),
  capability("R06", "AGENT_RUNTIME", "DETERMINISTIC_ORACLE", "U13", "DETERMINISTIC_ORACLE", [
    "R03",
  ]),
  capability("R07", "WEB", "PUBLIC_EVENT_LEDGER", "U9", "AUDIT_EVENT"),
  capability("R08", "AGENT_RUNTIME", "SIGNED_MANIFEST", "U14", "AUDIT_EVENT", ["M12"]),
  capability("R09", "WEB", "ARTIFACT_AUTHORITY", "U12", "CONTEXT_CAPACITY", ["R01"]),
  capability("R10", "EVALS", "DETERMINISTIC_ORACLE", "U18", "DETERMINISTIC_ORACLE", ["R06"]),
  capability("T01", "AGENT_RUNTIME", "SIGNED_MANIFEST", "U20", "AUTHORITY_RECEIPT"),
  capability("T02", "AGENT_RUNTIME", "ARTIFACT_AUTHORITY", "U20", "ARTIFACT_PROOF", ["T01", "A01"]),
  capability("T03", "AGENT_RUNTIME", "POSTGRESQL", "U20", "AUTHORITY_RECEIPT", ["T01", "S12"]),
  capability("T04", "AGENT_RUNTIME", "ARTIFACT_AUTHORITY", "U20", "ARTIFACT_PROOF", ["T01"]),
  capability("T05", "AGENT_RUNTIME", "PUBLIC_EVENT_LEDGER", "U19", "EXECUTION_RECOVERY"),
  capability("T06", "AGENT_RUNTIME", "SIGNED_MANIFEST", "U19", "CONTEXT_CAPACITY", ["T05"]),
  capability("T07", "AGENT_RUNTIME", "SIGNED_MANIFEST", "U20", "AUDIT_EVENT", ["T01", "T05"]),
  capability("T08", "EVALS", "DETERMINISTIC_ORACLE", "U18", "EXECUTION_RECOVERY", ["T05", "R10"]),
] as const;

export const PLATFORM_CAPABILITY_MANIFEST = deepFreeze(
  platformCapabilityManifestStructureSchema.parse(manifestInput),
);

/**
 * Public parsing is deliberately stricter than structural validation: every
 * field of every entry must equal the frozen 58-entry definition snapshot.
 * Runtime delivery states belong to a later Receipt projection and cannot be
 * asserted by changing this manifest.
 */
export const platformCapabilityManifestSchema =
  platformCapabilityManifestStructureSchema.superRefine((descriptors, ctx) => {
    for (const [index, expected] of PLATFORM_CAPABILITY_MANIFEST.entries()) {
      const actual = descriptors[index];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        ctx.addIssue({
          code: "custom",
          message: `Capability definition 必须匹配 frozen snapshot: ${expected.capability_id}`,
          path: [index],
        });
      }
    }
  });

export function parsePlatformCapabilityManifest(input: unknown) {
  return deepFreeze(platformCapabilityManifestSchema.parse(input));
}

export type PlatformCapabilityId = z.infer<typeof platformCapabilityIdSchema>;
export type PlatformCapabilityDescriptor = z.infer<typeof platformCapabilityDescriptorSchema>;
export type PlatformCapabilityManifest = z.infer<typeof platformCapabilityManifestSchema>;
export type CapabilityEvidenceKind = z.infer<typeof capabilityEvidenceKindSchema>;
