export const RETIREMENT_ACTIONS = [
  "KEEP_CURRENT",
  "MOVE_DIRECT",
  "DELETE",
  "ARCHIVE_DATA",
] as const;

export type RetirementAction = (typeof RETIREMENT_ACTIONS)[number];
export type RetirementSurfaceStatus = "CURRENT" | "HISTORICAL" | "REMOVED";

export interface RetirementSurfaceEntry {
  readonly surface: string;
  readonly kind: string;
  readonly currentConsumers: string;
  readonly action: RetirementAction;
  readonly unit: string;
  readonly finalTarget: string;
  readonly evidence: string;
  readonly status: RetirementSurfaceStatus;
}

const tableHeader = [
  "Surface",
  "Kind",
  "Current consumers",
  "Action",
  "Atomic switch unit",
  "Final target",
  "Evidence",
  "Status",
];

function cells(line: string): string[] {
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim().replaceAll("`", ""));
}

export function parseRetirementSurfaceLedger(markdown: string): RetirementSurfaceEntry[] {
  const lines = markdown.split("\n");
  const headerIndex = lines.findIndex(
    (line) => line.startsWith("|") && cells(line).join("\u0000") === tableHeader.join("\u0000"),
  );
  if (headerIndex < 0) throw new Error("retirement surface ledger table header is missing");

  const entries: RetirementSurfaceEntry[] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith("|")) break;
    const values = cells(line);
    if (values.length !== tableHeader.length) {
      throw new Error(`retirement surface row has ${values.length} cells; expected 8`);
    }
    const [surface, kind, currentConsumers, action, unit, finalTarget, evidence, status] = values;
    if (
      !surface ||
      !kind ||
      !currentConsumers ||
      !unit ||
      !finalTarget ||
      !evidence ||
      !RETIREMENT_ACTIONS.includes(action as RetirementAction) ||
      !["CURRENT", "HISTORICAL", "REMOVED"].includes(status ?? "")
    ) {
      throw new Error(`retirement surface row is incomplete or invalid: ${line}`);
    }
    entries.push({
      surface,
      kind,
      currentConsumers,
      action: action as RetirementAction,
      unit,
      finalTarget,
      evidence,
      status: status as RetirementSurfaceStatus,
    });
  }
  return entries;
}

export function validateRetirementSurfaceLedger(
  entries: readonly RetirementSurfaceEntry[],
  requiredSurfaces: readonly string[],
): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();
  const forbiddenTransitionTerms =
    /compatibility adapter|re-export|dual read|dual write|redirect|tombstone|composition fallback/i;
  for (const entry of entries) {
    if (seen.has(entry.surface)) violations.push(`duplicate surface: ${entry.surface}`);
    seen.add(entry.surface);
    if (entry.action === "KEEP_CURRENT" && entry.finalTarget !== "unchanged") {
      violations.push(`KEEP_CURRENT surface must target unchanged: ${entry.surface}`);
    }
    if (entry.status === "REMOVED" && entry.currentConsumers !== "none") {
      violations.push(`REMOVED surface must have no current consumers: ${entry.surface}`);
    }
    if (forbiddenTransitionTerms.test(`${entry.unit} ${entry.finalTarget}`)) {
      violations.push(`compatibility transition is forbidden: ${entry.surface}`);
    }
    if (
      entry.kind === "RELIABILITY" &&
      (entry.action !== "KEEP_CURRENT" || !/test/i.test(entry.evidence))
    ) {
      violations.push(`reliability fallback needs KEEP_CURRENT characterization: ${entry.surface}`);
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
      .filter((entry) => entry.kind === "EXPORT" && entry.status === "CURRENT")
      .map((entry) => entry.surface),
  );
  return exportedModuleSpecifiers(source)
    .filter((specifier) => /billing|pricing|credit|legacy|compat/i.test(specifier))
    .filter((specifier) => !trackedCurrentExports.has(specifier))
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
      .filter((entry) => entry.kind === "APP_SCHEMA_COPY" && entry.status === "CURRENT")
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
