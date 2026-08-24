import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue };

type OperatorManifestEntry = {
  readonly operator_id: string;
  readonly description_zh: string;
  readonly implementation: {
    readonly module: string;
    readonly symbol: string;
  };
  readonly runtime_profile: "CORE_ANALYSIS" | "ML_DIAGNOSTIC";
  readonly batching: {
    readonly mode: "LABELED_BATCH";
    readonly max_items: number;
  };
  readonly inputs: readonly JsonValue[];
  readonly parameters: readonly JsonValue[];
  readonly outputs: JsonValue;
  readonly applicability_checks: readonly string[];
  readonly limitations: readonly string[];
};

type OperatorManifest = {
  readonly schema_version: "statistical-operator-manifest@1.0.0";
  readonly registry_id: string;
  readonly operators: readonly OperatorManifestEntry[];
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(
  repositoryRoot,
  "services/sandbox/src/data_agent_sandbox/python_runtime/operators/manifest.json",
);
const generatedPath = resolve(
  repositoryRoot,
  "packages/contracts/src/generated/statistical-operators.ts",
);

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertClosedObject(
  value: unknown,
  allowedKeys: readonly string[],
  context: string,
): asserts value is Record<string, unknown> {
  assertCondition(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${context} 必须是对象。`,
  );
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  assertCondition(unknown.length === 0, `${context} 含未知字段：${unknown.join(", ")}`);
}

function assertStringArray(value: unknown, context: string): asserts value is readonly string[] {
  assertCondition(Array.isArray(value), `${context} 必须是数组。`);
  assertCondition(
    value.every((item) => typeof item === "string" && item.length > 0),
    `${context} 只能包含非空字符串。`,
  );
  assertCondition(new Set(value).size === value.length, `${context} 不允许重复值。`);
}

function assertNoCompatibilityKeys(value: unknown, path = "manifest"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoCompatibilityKeys(item, `${path}[${index}]`);
    });
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    assertCondition(
      !["alias", "aliases", "overwrite", "overwrites", "legacy_id", "fallback"].includes(key),
      `${path}.${key} 禁止兼容、覆盖或回退字段。`,
    );
    assertNoCompatibilityKeys(child, `${path}.${key}`);
  }
}

export function parseStatisticalOperatorManifest(text: string): OperatorManifest {
  assertCondition(!text.includes("\r"), "manifest 必须使用 LF 换行。 ");
  assertCondition(
    text.endsWith("\n") && !text.endsWith("\n\n"),
    "manifest 必须且只能以一个换行结尾。",
  );
  const candidate: unknown = JSON.parse(text);
  assertClosedObject(candidate, ["schema_version", "registry_id", "operators"], "manifest");
  assertCondition(
    candidate.schema_version === "statistical-operator-manifest@1.0.0",
    "manifest schema_version 不受支持。",
  );
  assertCondition(
    typeof candidate.registry_id === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$/u.test(candidate.registry_id),
    "manifest registry_id 非法。",
  );
  assertCondition(Array.isArray(candidate.operators), "manifest operators 必须是数组。");
  assertCondition(candidate.operators.length === 7, "首版 manifest 必须且只能包含七个算子。");

  const ids = new Set<string>();
  const implementations = new Set<string>();
  for (const [index, rawOperator] of candidate.operators.entries()) {
    const context = `manifest.operators[${index}]`;
    assertClosedObject(
      rawOperator,
      [
        "operator_id",
        "description_zh",
        "implementation",
        "runtime_profile",
        "batching",
        "inputs",
        "parameters",
        "outputs",
        "applicability_checks",
        "limitations",
      ],
      context,
    );
    assertCondition(
      typeof rawOperator.operator_id === "string" &&
        /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+@[1-9][0-9]*$/u.test(rawOperator.operator_id),
      `${context}.operator_id 非法。`,
    );
    assertCondition(!ids.has(rawOperator.operator_id), `${context}.operator_id 重复。`);
    ids.add(rawOperator.operator_id);
    assertCondition(
      typeof rawOperator.description_zh === "string" && rawOperator.description_zh.length > 0,
      `${context}.description_zh 必须是非空字符串。`,
    );
    assertClosedObject(
      rawOperator.implementation,
      ["module", "symbol"],
      `${context}.implementation`,
    );
    assertCondition(
      typeof rawOperator.implementation.module === "string" &&
        /^data_agent_sandbox\.python_runtime\.operators\.[a-z][a-z0-9_]*$/u.test(
          rawOperator.implementation.module,
        ),
      `${context}.implementation.module 非法。`,
    );
    assertCondition(
      typeof rawOperator.implementation.symbol === "string" &&
        /^[a-z][a-z0-9_]*$/u.test(rawOperator.implementation.symbol),
      `${context}.implementation.symbol 非法。`,
    );
    const implementationKey = `${rawOperator.implementation.module}:${rawOperator.implementation.symbol}`;
    assertCondition(!implementations.has(implementationKey), `${context}.implementation 重复。`);
    implementations.add(implementationKey);
    assertCondition(
      rawOperator.runtime_profile === "CORE_ANALYSIS" ||
        rawOperator.runtime_profile === "ML_DIAGNOSTIC",
      `${context}.runtime_profile 非法。`,
    );
    assertClosedObject(rawOperator.batching, ["mode", "max_items"], `${context}.batching`);
    assertCondition(
      rawOperator.batching.mode === "LABELED_BATCH",
      `${context}.batching.mode 非法。`,
    );
    assertCondition(
      Number.isSafeInteger(rawOperator.batching.max_items) &&
        Number(rawOperator.batching.max_items) > 0 &&
        Number(rawOperator.batching.max_items) <= 5000,
      `${context}.batching.max_items 超界。`,
    );
    assertCondition(
      Array.isArray(rawOperator.inputs) && rawOperator.inputs.length > 0,
      `${context}.inputs 不能为空。`,
    );
    assertCondition(Array.isArray(rawOperator.parameters), `${context}.parameters 必须是数组。`);
    assertClosedObject(
      rawOperator.outputs,
      ["collection", "label_fields", "value_fields", "evidence_fields"],
      `${context}.outputs`,
    );
    assertStringArray(rawOperator.outputs.label_fields, `${context}.outputs.label_fields`);
    assertStringArray(rawOperator.outputs.value_fields, `${context}.outputs.value_fields`);
    assertStringArray(rawOperator.outputs.evidence_fields, `${context}.outputs.evidence_fields`);
    assertStringArray(rawOperator.applicability_checks, `${context}.applicability_checks`);
    assertStringArray(rawOperator.limitations, `${context}.limitations`);
  }
  assertNoCompatibilityKeys(candidate);
  return candidate as OperatorManifest;
}

function sha256(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function computeStatisticalOperatorManifestDigest(
  manifestSource: string,
): `sha256:${string}` {
  parseStatisticalOperatorManifest(manifestSource);
  return sha256(manifestSource);
}

function renderGeneratedContract(
  manifest: OperatorManifest,
  sourceDigest: `sha256:${string}`,
): string {
  const ids = manifest.operators.map(({ operator_id }) => operator_id);
  const manifestLiteral = JSON.stringify(manifest, null, 2);
  const idsLiteral = JSON.stringify(ids, null, 2);
  return `// DO NOT EDIT. Generated by scripts/generate-statistical-operator-contracts.ts.\n// source_sha256: ${sourceDigest}\n\nimport { z } from "zod";\nimport { contentHashSchema } from "../common/index.js";\n\nexport const STATISTICAL_OPERATOR_MANIFEST_DIGEST = "${sourceDigest}" as const;\nexport const STATISTICAL_OPERATOR_MANIFEST = ${manifestLiteral} as const;\nexport const STATISTICAL_OPERATOR_IDS = ${idsLiteral} as const;\nexport const statisticalOperatorIdSchema = z.enum(STATISTICAL_OPERATOR_IDS);\n\nexport const GENERATED_ANALYSIS_SOURCE_POLICIES = [\n  "NO_GENERATED_SOURCE",\n  "OPEN_ANALYSIS",\n  "GOVERNED_OPERATOR_ORCHESTRATION",\n] as const;\nexport const generatedAnalysisSourcePolicySchema = z.enum(GENERATED_ANALYSIS_SOURCE_POLICIES);\n\nconst stableIdentifierSchema = z\n  .string()\n  .min(1)\n  .max(128)\n  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u);\nconst outputNameSchema = z\n  .string()\n  .min(1)\n  .max(63)\n  .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/u);\nconst jsonPointerSchema = z\n  .string()\n  .min(1)\n  .max(512)\n  .regex(/^(?:\\/(?:[^~/]|~0|~1)*)+$/u);\nconst stableReasonCodeSchema = z\n  .string()\n  .min(1)\n  .max(128)\n  .regex(/^[A-Z][A-Z0-9_]*$/u);\nconst canonicalParameterValueSchema = z.union([\n  z.string().max(256),\n  z.number().finite(),\n  z.boolean(),\n  z.null(),\n]);\n\nfunction uniqueStrings(values: readonly string[], context: z.RefinementCtx, path: PropertyKey[]): void {\n  const seen = new Set<string>();\n  for (const [index, value] of values.entries()) {\n    if (seen.has(value)) {\n      context.addIssue({ code: "custom", message: "值必须唯一。", path: [...path, index] });\n    }\n    seen.add(value);\n  }\n}\n\nexport const statisticalOperatorValueBindingSchema = z.strictObject({\n  result_field: stableIdentifierSchema,\n  operator_field: stableIdentifierSchema,\n  comparison: z.enum(["EXACT", "NUMERIC_TOLERANCE"]),\n  absolute_tolerance: z.number().finite().nonnegative().max(1),\n  relative_tolerance: z.number().finite().nonnegative().max(1),\n});\n\nexport const statisticalOperatorResultBindingSchema = z\n  .strictObject({\n    result_output_name: outputNameSchema,\n    result_collection_path: jsonPointerSchema,\n    operator_collection_path: jsonPointerSchema,\n    label_fields: z.array(stableIdentifierSchema).min(1).max(8),\n    value_bindings: z.array(statisticalOperatorValueBindingSchema).min(1).max(32),\n    require_exact_label_set: z.literal(true),\n  })\n  .superRefine((binding, context) => {\n    uniqueStrings(binding.label_fields, context, ["label_fields"]);\n    uniqueStrings(\n      binding.value_bindings.map(({ result_field }) => result_field),\n      context,\n      ["value_bindings"],\n    );\n    uniqueStrings(\n      binding.value_bindings.map(({ operator_field }) => operator_field),\n      context,\n      ["value_bindings"],\n    );\n    for (const [index, valueBinding] of binding.value_bindings.entries()) {\n      if (\n        valueBinding.comparison === "EXACT" &&\n        (valueBinding.absolute_tolerance !== 0 || valueBinding.relative_tolerance !== 0)\n      ) {\n        context.addIssue({\n          code: "custom",\n          message: "EXACT 绑定的容差必须为零。",\n          path: ["value_bindings", index],\n        });\n      }\n    }\n  });\n\nexport const statisticalOperatorObligationSchema = z.strictObject({\n  call_id: stableIdentifierSchema,\n  operator_id: statisticalOperatorIdSchema,\n  result_binding: statisticalOperatorResultBindingSchema,\n});\n\nexport const statisticalOperatorObligationsSchema = z\n  .array(statisticalOperatorObligationSchema)\n  .max(32)\n  .superRefine((obligations, context) => {\n    uniqueStrings(\n      obligations.map(({ call_id }) => call_id),\n      context,\n      [],\n    );\n  });\n\nexport const statisticalOperatorCallReceiptSchema = z.strictObject({\n  schema_version: z.literal("statistical-operator-call-receipt@1.0.0"),\n  call_id: stableIdentifierSchema,\n  operator_id: statisticalOperatorIdSchema,\n  operator_registry_digest: contentHashSchema,\n  implementation_digest: contentHashSchema,\n  resolved_parameters: z\n    .record(stableIdentifierSchema, canonicalParameterValueSchema)\n    .superRefine((parameters, context) => {\n      if (Object.keys(parameters).length > 32) {\n        context.addIssue({ code: "custom", message: "resolved_parameters 最多 32 项。" });\n      }\n    }),\n  resolved_parameters_hash: contentHashSchema,\n  input_hash: contentHashSchema,\n  output_hash: contentHashSchema,\n  result_binding_hash: contentHashSchema,\n  sample_size: z.number().int().nonnegative().nullable(),\n  group_count: z.number().int().nonnegative().nullable(),\n  family_size: z.number().int().nonnegative().nullable(),\n  rank: z.number().int().nonnegative().nullable(),\n  applicability: z.literal("PASS"),\n  limitation_codes: z.array(stableReasonCodeSchema).max(16).superRefine((values, context) => {\n    uniqueStrings(values, context, []);\n  }),\n});\n\nexport type StatisticalOperatorId = z.infer<typeof statisticalOperatorIdSchema>;\nexport type GeneratedAnalysisSourcePolicy = z.infer<typeof generatedAnalysisSourcePolicySchema>;\nexport type StatisticalOperatorObligation = z.infer<typeof statisticalOperatorObligationSchema>;\nexport type StatisticalOperatorCallReceipt = z.infer<typeof statisticalOperatorCallReceiptSchema>;\n`;
}

function formatGeneratedContract(candidate: string): string {
  const result = spawnSync(
    "pnpm",
    ["exec", "biome", "format", "--stdin-file-path", generatedPath],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      input: candidate,
    },
  );
  assertCondition(
    result.status === 0 && result.stdout.length > 0,
    `generated contract 格式化失败：${result.stderr.trim()}`,
  );
  return result.stdout;
}

export function renderStatisticalOperatorContract(manifestSource: string): string {
  const manifest = parseStatisticalOperatorManifest(manifestSource);
  return formatGeneratedContract(
    renderGeneratedContract(manifest, computeStatisticalOperatorManifestDigest(manifestSource)),
  );
}

function main(): void {
  assertCondition(existsSync(manifestPath), `operator manifest 不存在：${manifestPath}`);
  const manifestSource = readFileSync(manifestPath, "utf8");
  const manifest = parseStatisticalOperatorManifest(manifestSource);
  const candidate = renderStatisticalOperatorContract(manifestSource);
  if (process.argv.includes("--check")) {
    assertCondition(existsSync(generatedPath), `generated contract 不存在：${generatedPath}`);
    assertCondition(
      readFileSync(generatedPath, "utf8") === candidate,
      "generated statistical operator contract 与 manifest 不一致；运行 pnpm generate:statistical-operators。",
    );
    console.log(`statistical operator contract verified: ${manifest.operators.length} operators`);
    return;
  }
  writeFileSync(generatedPath, candidate, "utf8");
  console.log(`generated statistical operator contract: ${manifest.operators.length} operators`);
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main();
}
