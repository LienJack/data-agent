import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  type benchmarkTableSchema,
  type PublicBenchmarkCase,
  publicBenchmarkCaseSchema,
  type SealedBenchmarkCase,
  sealedBenchmarkCaseSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";

type BenchmarkTable = z.infer<typeof benchmarkTableSchema>;

const tableNameSchema = z.enum([
  "dim_date",
  "dim_customer",
  "dim_seller",
  "dim_category",
  "dim_product",
  "dim_geolocation_zip",
  "dim_amazon_product",
  "dim_ebay_listing",
  "fact_order",
  "fact_order_item",
  "fact_payment",
  "fact_review",
  "fact_amazon_review",
  "fact_delivery_state_month",
]);

const sourcePublicCaseSchema = z.strictObject({
  case_id: z.uuid(),
  suite_id: z.literal("ecommerce-production"),
  suite_version: z.literal("1.0.0"),
  dataset_version: z.literal("adb-ecommerce-bounded-v1"),
  ordinal: z.number().int().min(1).max(24),
  title: z.string().min(1).max(256),
  question: z.string().min(1).max(20_000),
  registry: z.enum(["DEMO", "TUNING", "HOLDOUT"]),
  difficulty: z.enum(["simple", "moderate", "challenging"]),
  tables: z.array(tableNameSchema).min(1).max(14),
  capabilities: z
    .array(z.enum(["TEXT_TO_SQL", "PYTHON_ANALYSIS", "DATA_AGENT_END_TO_END"]))
    .min(1)
    .max(3),
  outputs: z.array(z.enum(["CSV", "JSON", "MARKDOWN", "VEGA_LITE", "PNG"])).min(1),
  python_required: z.boolean(),
  chart_or_report_required: z.boolean(),
  public_case_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

const manifestSchema = z.strictObject({
  schema_version: z.literal("ecommerce-production-suite-manifest@1.0.0"),
  suite_id: z.literal("ecommerce-production"),
  suite_version: z.literal("1.0.0"),
  dataset_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  case_count: z.literal(24),
  registry_counts: z.strictObject({
    DEMO: z.literal(8),
    TUNING: z.literal(10),
    HOLDOUT: z.literal(6),
  }),
  difficulty_counts: z.strictObject({
    simple: z.literal(6),
    moderate: z.literal(10),
    challenging: z.literal(8),
  }),
  hard_six_table_count: z.number().int().min(6),
  python_case_count: z.number().int().min(8),
  chart_or_report_case_count: z.number().int().min(4),
  public_cases_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sealed_cases_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  readiness: z.literal("HOLD"),
  readiness_reason: z.string().min(1),
  manifest_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

const sourceSealedCaseSchema = z.strictObject({
  public_case: sourcePublicCaseSchema,
  gold_sql: z.string().min(1).max(100_000),
  oracle_policy: z.literal("postgres-result-and-artifact-rules@1.0.0"),
  sealed_case_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

type ColumnDefinition = readonly [
  name: string,
  dataType: string,
  nullable?: boolean,
  primaryKey?: boolean,
];

const definitions: Readonly<Record<z.infer<typeof tableNameSchema>, readonly ColumnDefinition[]>> =
  {
    dim_date: [
      ["date_key", "date", false, true],
      ["calendar_year", "integer"],
      ["calendar_quarter", "integer"],
      ["calendar_month", "integer"],
      ["month_key", "text"],
      ["day_of_month", "integer"],
      ["day_of_week", "integer"],
      ["is_weekend", "boolean"],
    ],
    dim_customer: [
      ["customer_id", "text", false, true],
      ["customer_unique_id", "text"],
      ["zip_code_prefix", "integer"],
      ["city", "text"],
      ["state", "text"],
    ],
    dim_seller: [
      ["seller_id", "text", false, true],
      ["zip_code_prefix", "integer"],
      ["city", "text"],
      ["state", "text"],
    ],
    dim_category: [
      ["category_name", "text", false, true],
      ["category_name_english", "text", true],
      ["is_electronics", "boolean"],
    ],
    dim_product: [
      ["product_id", "text", false, true],
      ["category_name", "text", true],
      ["category_name_english", "text", true],
      ["photos_quantity", "integer", true],
      ["weight_g", "numeric(14,3)", true],
      ["length_cm", "numeric(14,3)", true],
      ["height_cm", "numeric(14,3)", true],
      ["width_cm", "numeric(14,3)", true],
    ],
    dim_geolocation_zip: [
      ["zip_code_prefix", "integer", false, true],
      ["state", "text", false, true],
      ["latitude", "double precision"],
      ["longitude", "double precision"],
      ["city_count", "integer"],
      ["source_point_count", "bigint"],
    ],
    dim_amazon_product: [
      ["asin", "text", false, true],
      ["title", "text", true],
      ["brand", "text", true],
      ["main_category", "text", true],
      ["price_usd", "numeric(14,2)", true],
      ["category", "jsonb"],
      ["feature", "jsonb"],
    ],
    dim_ebay_listing: [
      ["listing_id", "bigint", false, true],
      ["brand", "text", true],
      ["price_usd", "numeric(14,2)", true],
      ["seller_rating", "numeric(8,3)", true],
      ["ratings_count", "integer", true],
      ["processor", "text", true],
      ["ram_gb", "numeric(10,2)", true],
      ["ssd_gb", "numeric(10,2)", true],
      ["gpu", "text", true],
      ["listing_type", "text", true],
      ["model", "text", true],
      ["operating_system", "text", true],
    ],
    fact_order: [
      ["order_id", "text", false, true],
      ["customer_id", "text"],
      ["order_status", "text"],
      ["purchased_at", "timestamp"],
      ["purchase_date", "date"],
      ["delivered_at", "timestamp", true],
      ["estimated_delivery_at", "timestamp", true],
      ["delivery_delay_days", "double precision", true],
    ],
    fact_order_item: [
      ["order_id", "text", false, true],
      ["order_item_id", "integer", false, true],
      ["product_id", "text"],
      ["seller_id", "text"],
      ["category_name_english", "text", true],
      ["shipping_limit_at", "timestamp", true],
      ["price_brl", "numeric(14,2)"],
      ["freight_value_brl", "numeric(14,2)"],
    ],
    fact_payment: [
      ["order_id", "text", false, true],
      ["payment_sequence", "integer", false, true],
      ["payment_type", "text"],
      ["installments", "integer"],
      ["payment_value_brl", "numeric(14,2)"],
    ],
    fact_review: [
      ["review_row_id", "bigint", false, true],
      ["review_id", "text"],
      ["order_id", "text"],
      ["review_score", "smallint"],
      ["comment_title", "text", true],
      ["comment_message", "text", true],
      ["created_at", "timestamp", true],
      ["answered_at", "timestamp", true],
    ],
    fact_amazon_review: [
      ["review_row_id", "bigint", false, true],
      ["asin", "text", true],
      ["reviewer_id", "text", true],
      ["rating", "numeric(4,2)", true],
      ["review_text", "text", true],
      ["summary", "text", true],
      ["reviewed_at", "date", true],
    ],
    fact_delivery_state_month: [
      ["seller_state", "text", false, true],
      ["customer_state", "text", false, true],
      ["purchase_month", "text", false, true],
      ["avg_delivery_delay_days", "double precision", true],
      ["avg_review_score", "double precision", true],
      ["total_orders", "bigint"],
      ["avg_freight_value_brl", "numeric(14,4)", true],
      ["avg_haversine_distance_km", "double precision", true],
    ],
  };

const tableCatalog = Object.fromEntries(
  Object.entries(definitions).map(([name, columns]) => [
    name,
    {
      name,
      columns: columns.map(([columnName, dataType, nullable = false, primaryKey = false]) => ({
        name: columnName,
        data_type: dataType,
        nullable,
        primary_key: primaryKey,
      })),
    } satisfies BenchmarkTable,
  ]),
) as Readonly<Record<z.infer<typeof tableNameSchema>, BenchmarkTable>>;

function hash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export interface EcommerceProductionPreviewDataset {
  readonly public_cases: readonly PublicBenchmarkCase[];
  readonly dataset_digest: `sha256:${string}`;
  readonly readiness: "HOLD";
  readonly readiness_reason: string;
}

export interface EcommerceProductionSqlDataset {
  readonly public_cases: readonly PublicBenchmarkCase[];
  readonly sealed_cases: readonly SealedBenchmarkCase[];
  readonly installed_digest: `sha256:${string}`;
  readonly database_path: "postgresql://demo_adb_ecommerce_mart";
}

function defaultProductionSuiteDirectory(): string {
  const cwd = resolve(process.cwd());
  const root =
    basename(cwd) === "web" && basename(resolve(cwd, "..")) === "apps"
      ? resolve(cwd, "../..")
      : cwd;
  return resolve(root, "infra/agenticdatabench/ecommerce-v1/production-suite");
}

/** Loads public-only material. This adapter deliberately never opens the sealed directory. */
export async function loadEcommerceProductionPreview(
  directory = defaultProductionSuiteDirectory(),
): Promise<EcommerceProductionPreviewDataset> {
  const [manifestValue, publicValue] = await Promise.all([
    readFile(resolve(directory, "manifest.json"), "utf8").then((value) => JSON.parse(value)),
    readFile(resolve(directory, "public-cases.json"), "utf8").then((value) => JSON.parse(value)),
  ]);
  const manifest = manifestSchema.parse(manifestValue);
  const sourceCases = z
    .array(sourcePublicCaseSchema)
    .length(manifest.case_count)
    .parse(publicValue);
  const { manifest_sha256: manifestHash, ...manifestDraft } = manifest;
  if (hash(manifestDraft) !== manifestHash || hash(sourceCases) !== manifest.public_cases_sha256) {
    throw new Error("ECOMMERCE_PRODUCTION_PREVIEW_DIGEST_MISMATCH");
  }
  const ordinals = new Set<number>();
  const publicCases: PublicBenchmarkCase[] = [];
  for (const sourceCase of sourceCases) {
    const { public_case_hash: sourceHash, ...sourceDraft } = sourceCase;
    if (hash(sourceDraft) !== sourceHash || ordinals.has(sourceCase.ordinal)) {
      throw new Error("ECOMMERCE_PRODUCTION_PREVIEW_CASE_INVALID");
    }
    ordinals.add(sourceCase.ordinal);
    const publicDraft = {
      case_id: sourceCase.case_id,
      suite_id: sourceCase.suite_id,
      suite_version: sourceCase.suite_version,
      dataset_version: sourceCase.dataset_version,
      ordinal: sourceCase.ordinal - 1,
      database_id: "demo_adb_ecommerce_mart",
      question: sourceCase.question,
      evidence: `题目：${sourceCase.title}；预期产物：${sourceCase.outputs.join("、")}；当前仅预览，Runner 与 Artifact Oracle 尚未认证。`,
      difficulty: sourceCase.difficulty,
      capabilities: sourceCase.capabilities,
      registry: sourceCase.registry,
      schema: sourceCase.tables.map((tableName) => tableCatalog[tableName]),
    };
    publicCases.push(
      publicBenchmarkCaseSchema.parse({
        ...publicDraft,
        public_case_hash: await sha256ContentHash(publicDraft),
      }),
    );
  }
  if (ordinals.size !== manifest.case_count) {
    throw new Error("ECOMMERCE_PRODUCTION_PREVIEW_CASE_COUNT_MISMATCH");
  }
  return Object.freeze({
    public_cases: Object.freeze(publicCases),
    dataset_digest: manifest.dataset_digest as `sha256:${string}`,
    readiness: manifest.readiness,
    readiness_reason: manifest.readiness_reason,
  });
}

/** Server/Worker-only loader. Never call this from a public route or browser bundle. */
export async function loadEcommerceProductionSqlDataset(
  directory = defaultProductionSuiteDirectory(),
): Promise<EcommerceProductionSqlDataset> {
  const preview = await loadEcommerceProductionPreview(directory);
  const [manifestValue, sealedValue] = await Promise.all([
    readFile(resolve(directory, "manifest.json"), "utf8").then((value) => JSON.parse(value)),
    readFile(resolve(directory, "sealed/sealed-cases.json"), "utf8").then((value) =>
      JSON.parse(value),
    ),
  ]);
  const manifest = manifestSchema.parse(manifestValue);
  const sourceSealedCases = z
    .array(sourceSealedCaseSchema)
    .length(manifest.case_count)
    .parse(sealedValue);
  if (hash(sourceSealedCases) !== manifest.sealed_cases_sha256) {
    throw new Error("ECOMMERCE_PRODUCTION_SEALED_DIGEST_MISMATCH");
  }
  const publicByCaseId = new Map(
    preview.public_cases.map((testCase) => [testCase.case_id, testCase]),
  );
  const seen = new Set<string>();
  const sealedCases: SealedBenchmarkCase[] = [];
  for (const sourceCase of sourceSealedCases) {
    const publicCase = publicByCaseId.get(sourceCase.public_case.case_id);
    if (
      !publicCase ||
      seen.has(publicCase.case_id) ||
      sourceCase.public_case.ordinal - 1 !== publicCase.ordinal ||
      sourceCase.public_case.public_case_hash !==
        hash(
          Object.fromEntries(
            Object.entries(sourceCase.public_case).filter(([key]) => key !== "public_case_hash"),
          ),
        ) ||
      sourceCase.sealed_case_hash !==
        hash({
          public_case_hash: sourceCase.public_case.public_case_hash,
          gold_sql: sourceCase.gold_sql,
        })
    ) {
      throw new Error("ECOMMERCE_PRODUCTION_SEALED_CASE_INVALID");
    }
    seen.add(publicCase.case_id);
    const sealedDraft = {
      public_case: publicCase,
      database_relative_path: "postgresql://demo_adb_ecommerce_mart",
      gold_sql: sourceCase.gold_sql,
    };
    sealedCases.push(
      sealedBenchmarkCaseSchema.parse({
        ...sealedDraft,
        sealed_case_hash: await sha256ContentHash(sealedDraft),
      }),
    );
  }
  return Object.freeze({
    public_cases: preview.public_cases,
    sealed_cases: Object.freeze(sealedCases),
    installed_digest: preview.dataset_digest,
    database_path: "postgresql://demo_adb_ecommerce_mart",
  });
}
