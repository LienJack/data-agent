import { z } from "zod";

export const RETIREMENT_DISPOSITIONS = [
  "KEEP_CURRENT",
  "KEEP_RELIABILITY_FALLBACK",
  "MIGRATE_THEN_DELETE",
  "ARCHIVE_TEST",
  "DELETE",
  "FROZEN_HISTORY",
] as const;

export const RETIREMENT_SURFACE_STATUSES = [
  "ACTIVE",
  "PLANNED",
  "ARCHIVED",
  "REMOVED",
  "FROZEN",
] as const;

const nonEmptyStringSchema = z.string().trim().min(1);
const retirementSurfaceEntrySchema = z.strictObject({
  surface: nonEmptyStringSchema,
  kind: nonEmptyStringSchema,
  owner: nonEmptyStringSchema,
  introduced_at: z.iso.date(),
  current_consumers: z.array(nonEmptyStringSchema),
  disposition: z.enum(RETIREMENT_DISPOSITIONS),
  removal_condition: nonEmptyStringSchema,
  deadline: z.iso.date().nullable(),
  replacement: nonEmptyStringSchema,
  evidence: z.array(nonEmptyStringSchema).min(1),
  status: z.enum(RETIREMENT_SURFACE_STATUSES),
});

const retirementSurfaceLedgerSchema = z.strictObject({
  schema_version: z.literal("retirement-surface-ledger@1.0.0"),
  entries: z.array(retirementSurfaceEntrySchema).min(1),
});

export type RetirementDisposition = (typeof RETIREMENT_DISPOSITIONS)[number];
export type RetirementSurfaceStatus = (typeof RETIREMENT_SURFACE_STATUSES)[number];
export type RetirementSurfaceEntry = z.infer<typeof retirementSurfaceEntrySchema>;

export function parseRetirementSurfaceLedger(source: string): RetirementSurfaceEntry[] {
  return retirementSurfaceLedgerSchema.parse(JSON.parse(source)).entries;
}

export function validateRetirementSurfaceLedger(
  entries: readonly RetirementSurfaceEntry[],
  requiredSurfaces: readonly string[],
): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (seen.has(entry.surface)) violations.push(`duplicate surface: ${entry.surface}`);
    seen.add(entry.surface);

    if (entry.status === "REMOVED" && entry.current_consumers.length > 0) {
      violations.push(`REMOVED surface must have no current consumers: ${entry.surface}`);
    }
    if (entry.kind === "RELIABILITY" && entry.disposition !== "KEEP_RELIABILITY_FALLBACK") {
      violations.push(`reliability fallback needs explicit retention: ${entry.surface}`);
    }
    if (
      entry.disposition === "KEEP_RELIABILITY_FALLBACK" &&
      (entry.kind !== "RELIABILITY" || !entry.evidence.some((item) => /test|spec/i.test(item)))
    ) {
      violations.push(`retained reliability fallback needs characterization: ${entry.surface}`);
    }
    if (
      ["MIGRATE_THEN_DELETE", "ARCHIVE_TEST", "DELETE"].includes(entry.disposition) &&
      entry.status !== "REMOVED" &&
      entry.deadline === null
    ) {
      violations.push(`retirement disposition needs deadline: ${entry.surface}`);
    }
    if (
      ["KEEP_CURRENT", "KEEP_RELIABILITY_FALLBACK", "FROZEN_HISTORY"].includes(entry.disposition) &&
      entry.deadline !== null
    ) {
      violations.push(`non-retiring surface must not declare deadline: ${entry.surface}`);
    }
  }

  for (const required of requiredSurfaces) {
    if (!seen.has(required)) violations.push(`missing required surface: ${required}`);
  }
  return violations.sort();
}

function exportedModuleSpecifiers(source: string): string[] {
  return [...source.matchAll(/export\s+(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g)].flatMap(
    (match) => (match[1] ? [match[1]] : []),
  );
}

export function findUntrackedRetirementExports(
  source: string,
  entries: readonly RetirementSurfaceEntry[],
): string[] {
  const trackedCurrentExports = new Set(
    entries
      .filter((entry) => entry.kind === "EXPORT" && entry.status === "ACTIVE")
      .map((entry) => entry.surface),
  );
  return exportedModuleSpecifiers(source)
    .filter((specifier) => /billing|pricing|credit|legacy|compat/i.test(specifier))
    .filter((specifier) => !trackedCurrentExports.has(specifier))
    .sort();
}

export interface RetirementSource {
  readonly path: string;
  readonly source: string;
}

function deprecatedSymbols(source: string): string[] {
  const symbols: string[] = [];
  const comments = source.matchAll(
    /\/\*\*(?:(?!\*\/)[\s\S])*?@deprecated(?:(?!\*\/)[\s\S])*?\*\//g,
  );
  for (const comment of comments) {
    const start = (comment.index ?? 0) + comment[0].length;
    const following = source.slice(start, start + 320);
    const declaration =
      /^\s*(?:export\s+)?(?:async\s+)?(?:declare\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/.exec(
        following,
      );
    const field = /^\s*readonly\s+([A-Za-z_$][\w$]*)/.exec(following);
    const symbol = declaration?.[1] ?? field?.[1];
    if (symbol) symbols.push(symbol);
  }
  return symbols;
}

export function findCompatibilitySurfaceMarkers(source: RetirementSource): string[] {
  if (source.path === "scripts/lib/retirement-surface-ledger.ts") return [];
  const markers = deprecatedSymbols(source.source).map((symbol) => `${source.path}#${symbol}`);
  if (/\bLEGACY_TEST_ONLY\b/.test(source.source)) {
    markers.push(`${source.path}#LEGACY_TEST_ONLY`);
  }
  for (const alias of ["DeepSeekAPIKey", "MoonshotAPIKey", "KimiAPIKey", "GLMAPIKey"] as const) {
    if (new RegExp(`\\b${alias}\\b`).test(source.source)) {
      markers.push(`${source.path}#env:${alias}`);
    }
  }
  return [...new Set(markers)].sort();
}

export function findUntrackedCompatibilitySurfaces(
  sources: readonly RetirementSource[],
  entries: readonly RetirementSurfaceEntry[],
): string[] {
  const tracked = new Set(entries.map((entry) => entry.surface));
  return sources
    .flatMap(findCompatibilitySurfaceMarkers)
    .filter((surface) => !tracked.has(surface))
    .sort();
}

export interface AppSemanticSchemaSource {
  readonly path: string;
  readonly source: string;
}

export function findUntrackedAppSemanticSchemaCopies(
  sources: readonly AppSemanticSchemaSource[],
  entries: readonly RetirementSurfaceEntry[],
): string[] {
  const tracked = new Set(
    entries
      .filter((entry) => entry.kind === "APP_SCHEMA_COPY" && entry.status === "ACTIVE")
      .map((entry) => entry.surface),
  );
  return sources
    .filter(
      ({ source }) =>
        /from\s+["']zod["']/.test(source) &&
        /export\s+const\s+semantic[A-Za-z0-9]+Schema\s*=\s*z\.(?:strictObject|object)/.test(source),
    )
    .map(({ path }) => path)
    .filter((path) => !tracked.has(path))
    .sort();
}
