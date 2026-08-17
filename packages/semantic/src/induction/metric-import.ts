import {
  type AppScope,
  buildSemanticMetricDryRunReceipt,
  type SemanticMetricDryRunReceipt,
  semanticMetricExchangeEntrySchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import { resolveStableSemanticObjects } from "./stable-object-resolver.js";

const metricImportInputSchema = z.strictObject({
  scope: z.custom<AppScope>(),
  semantic_domain: z.string().min(1).max(64),
  import_id: z.string().uuid(),
  source_format: z.enum(["OSI_METRIC_EXCHANGE", "OSSIE_METRIC_EXCHANGE"]),
  metrics: z.array(semanticMetricExchangeEntrySchema).min(1).max(10_000),
  existing: z
    .array(
      z.strictObject({
        external_id: z.string().min(1).max(256),
        stable_object_id: z.string().uuid(),
        definition_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      }),
    )
    .max(10_000),
});

function expressionIsSafe(expression: string): boolean {
  return (
    /^[A-Za-z_][A-Za-z0-9_.]*(?:\([A-Za-z0-9_., +*/()-]+\))?$/.test(expression.trim()) &&
    !/\b(?:drop|delete|insert|update|alter|grant|revoke|select)\b/i.test(expression)
  );
}

export async function runMetricImportDryRun(
  input: z.input<typeof metricImportInputSchema>,
): Promise<
  Readonly<{
    receipt: SemanticMetricDryRunReceipt;
    candidate_patch: null | Readonly<{
      schema_version: "semantic-metric-candidate-patch@1.0.0";
      metrics: readonly unknown[];
      patch_hash: string;
    }>;
  }>
> {
  const parsed = metricImportInputSchema.parse(input);
  const metrics = [...parsed.metrics].sort((left, right) =>
    left.external_id.localeCompare(right.external_id),
  );
  const duplicateIds = new Set<string>();
  const conflictingIds = new Set<string>();
  metrics.forEach((metric, index) => {
    if (metrics[index - 1]?.external_id === metric.external_id)
      duplicateIds.add(metric.external_id);
  });
  for (const externalId of duplicateIds) {
    const definitions = new Set(
      metrics
        .filter((metric) => metric.external_id === externalId)
        .map((metric) => JSON.stringify([metric.name, metric.expression.trim(), metric.unit])),
    );
    if (definitions.size > 1) conflictingIds.add(externalId);
  }
  const existing = new Map(parsed.existing.map((entry) => [entry.external_id, entry]));
  const entries = [];
  const patchMetrics = [];
  const uniqueMetrics = [
    ...new Map(metrics.map((metric) => [metric.external_id, metric])).values(),
  ];
  for (const metric of uniqueMetrics) {
    const issues: string[] = [];
    if (conflictingIds.has(metric.external_id)) issues.push("CONFLICTING_EXTERNAL_ID");
    else if (duplicateIds.has(metric.external_id)) issues.push("DUPLICATE_EXTERNAL_ID");
    if (!expressionIsSafe(metric.expression)) issues.push("UNSUPPORTED_OR_UNSAFE_EXPRESSION");
    const resolved = await resolveStableSemanticObjects([
      {
        namespace: parsed.semantic_domain,
        object_role: "METRIC",
        name: metric.name,
        aliases: [metric.external_id],
        mapping_identities: [`metric-exchange:${parsed.source_format}:${metric.external_id}`],
        evidence_identities: [`metric-input:${metric.external_id}`],
      },
    ]);
    const stableObject = resolved.objects[0];
    const definitionHash = await sha256ContentHash({
      external_id: metric.external_id,
      name: metric.name,
      expression: metric.expression.trim(),
      unit: metric.unit,
    });
    const previous = existing.get(metric.external_id);
    const stableObjectId = stableObject?.object_id ?? null;
    if (
      previous !== undefined &&
      stableObjectId !== null &&
      previous.stable_object_id !== stableObjectId
    ) {
      issues.push("STABLE_OBJECT_IDENTITY_CONFLICT");
    }
    const hasConflict = issues.some((issue) => issue.includes("CONFLICT"));
    const disposition: "CREATE" | "UPDATE" | "UNCHANGED" | "INVALID" | "CONFLICT" = hasConflict
      ? "CONFLICT"
      : issues.length > 0
        ? "INVALID"
        : previous?.definition_hash === definitionHash
          ? "UNCHANGED"
          : previous
            ? "UPDATE"
            : "CREATE";
    entries.push({
      external_id: metric.external_id,
      disposition,
      stable_object_id: issues.length > 0 ? null : (previous?.stable_object_id ?? stableObjectId),
      issues,
    });
    if (issues.length === 0 && disposition !== "UNCHANGED") {
      patchMetrics.push({
        external_id: metric.external_id,
        stable_object_id: previous?.stable_object_id ?? stableObject?.object_id,
        name: metric.name,
        expression: metric.expression.trim(),
        unit: metric.unit,
        definition_hash: definitionHash,
        disposition,
      });
    }
  }
  const sourceHash = await sha256ContentHash({ source_format: parsed.source_format, metrics });
  const hasConflict = entries.some((entry) => entry.disposition === "CONFLICT");
  const valid = entries.every(
    (entry) => entry.disposition !== "INVALID" && entry.disposition !== "CONFLICT",
  );
  const patchDraft = valid
    ? { schema_version: "semantic-metric-candidate-patch@1.0.0" as const, metrics: patchMetrics }
    : null;
  const patchHash = patchDraft ? await sha256ContentHash(patchDraft) : null;
  const receipt = await buildSemanticMetricDryRunReceipt({
    schema_version: "semantic-metric-dry-run-receipt@1.0.0",
    scope: parsed.scope,
    semantic_domain: parsed.semantic_domain,
    import_id: parsed.import_id,
    source_hash: sourceHash,
    status: valid ? "VALID" : hasConflict ? "CONFLICT" : "INVALID",
    entries,
    candidate_patch_hash: patchHash,
  });
  return {
    receipt,
    candidate_patch: patchDraft
      ? Object.freeze({ ...patchDraft, patch_hash: patchHash as string })
      : null,
  };
}
