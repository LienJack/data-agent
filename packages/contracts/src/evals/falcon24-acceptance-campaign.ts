import { z } from "zod";
import { artifactReferenceIdentity, artifactReferenceSchema } from "../artifacts/envelope.js";
import {
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
} from "../common/index.js";
import {
  FALCON24_TARGET_AUTHORITY_EPOCH,
  falcon24AuthorityEpochSchema,
  falcon24SuccessorAuthorityEpochSchema,
} from "../runs/falcon24-authority-identity.js";
import { falcon24AnalysisCaseIdSchema } from "./falcon24-agent-analysis.js";

export const FALCON24_STRICT_ACCEPTANCE_POLICY_ID = "falcon24-strict-zero-retry@1.0.0" as const;
export const FALCON24_E1_QUALIFICATION_ID = "E1-Q1" as const;
export const FALCON24_E1_CAMPAIGN_ID = "E1-C1" as const;
export const FALCON24_TARGET_QUALIFICATION_ID = `${FALCON24_TARGET_AUTHORITY_EPOCH}-Q1` as const;
export const FALCON24_TARGET_CAMPAIGN_ID = `${FALCON24_TARGET_AUTHORITY_EPOCH}-C1` as const;

export const FALCON24_REQUIRED_UI_ARTIFACT_TYPES = Object.freeze([
  "AnalysisReport",
  "ArtifactWorkspaceDocument",
  "DerivedAnalysisEvidence",
  "QueryEvidence",
  "SqlArtifact",
] as const);

export const falcon24E1AcceptanceCampaignIdSchema = z.literal(FALCON24_E1_CAMPAIGN_ID);
export const falcon24E1GateIdSchema = z.union([
  z.literal(FALCON24_E1_QUALIFICATION_ID),
  falcon24E1AcceptanceCampaignIdSchema,
]);
export const falcon24QualificationGateIdSchema = z
  .string()
  .regex(/^E[1-9][0-9]*-Q1$/u, "Falcon24 qualification gate 只允许 canonical <epoch>-Q1。");
export const falcon24AcceptanceCampaignIdSchema = z
  .string()
  .regex(/^E[1-9][0-9]*-C1$/u, "Falcon24 campaign gate 只允许 canonical <epoch>-C1。");
export const falcon24GateIdSchema = z.union([
  falcon24QualificationGateIdSchema,
  falcon24AcceptanceCampaignIdSchema,
]);

export function qualificationIdForEpoch(input: unknown): `${string}-Q1` {
  const epoch = falcon24AuthorityEpochSchema.parse(input);
  return `${epoch}-Q1`;
}

export function campaignIdForEpoch(input: unknown): `${string}-C1` {
  const epoch = falcon24AuthorityEpochSchema.parse(input);
  return `${epoch}-C1`;
}

export function authorityEpochForFalcon24Gate(input: unknown): string {
  const gateId = falcon24GateIdSchema.parse(input);
  return falcon24AuthorityEpochSchema.parse(gateId.slice(0, gateId.lastIndexOf("-")));
}

function addGateEpochIssue(
  receipt: { authority_epoch: string; campaign_id: string },
  context: z.RefinementCtx,
): void {
  if (authorityEpochForFalcon24Gate(receipt.campaign_id) !== receipt.authority_epoch) {
    context.addIssue({
      code: "custom",
      message: "campaign_id 必须与 authority_epoch 派生值一致。",
      path: ["campaign_id"],
    });
  }
}

export const FALCON24_ACCEPTANCE_FAILURE_LAYER_ORDER = Object.freeze([
  "ROOT_ROUTING",
  "SQL_DATA_PREPARATION",
  "GOVERNED_OPERATOR",
  "ORACLE",
  "PUBLISHER",
  "SANDBOX_RECLAMATION",
] as const);

export const falcon24AcceptanceFailureLayerSchema = z.enum(FALCON24_ACCEPTANCE_FAILURE_LAYER_ORDER);

export const falcon24AcceptanceManifestRunSchema = z.strictObject({
  run_id: immutableIdSchema,
  case_id: falcon24AnalysisCaseIdSchema,
  run_variant: z.enum(["COLD", "WARM"]),
  repetition: z.number().int().min(1).max(3),
});

function addAcceptanceRunManifestIssues(
  manifest: { runs: readonly z.infer<typeof falcon24AcceptanceManifestRunSchema>[] },
  context: z.RefinementCtx,
): void {
  const runIds = new Set(manifest.runs.map(({ run_id: runId }) => runId));
  const observedSlots = new Set(
    manifest.runs.map(
      ({ case_id: caseId, run_variant: variant, repetition }) =>
        `${caseId}\0${variant}\0${repetition}`,
    ),
  );
  const expectedSlots = new Set(
    falcon24AnalysisCaseIdSchema.options.flatMap((caseId) =>
      (["COLD", "WARM"] as const).flatMap((variant) =>
        [1, 2, 3].map((repetition) => `${caseId}\0${variant}\0${repetition}`),
      ),
    ),
  );
  if (
    runIds.size !== 30 ||
    observedSlots.size !== 30 ||
    [...expectedSlots].some((slot) => !observedSlots.has(slot))
  ) {
    context.addIssue({
      code: "custom",
      message: "Falcon24 Manifest 必须精确覆盖 5 题各 3 冷、3 暖且 Run ID 唯一。",
      path: ["runs"],
    });
  }
}

const falcon24AcceptanceRunManifestMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-analysis-run-manifest@2.0.0"),
    campaign_id: falcon24E1AcceptanceCampaignIdSchema,
    attempt_id: immutableIdSchema,
    winning_qualification_attempt_id: immutableIdSchema,
    authority_baseline_hash: contentHashSchema,
    source_fingerprint: contentHashSchema,
    frozen_contract_hash: contentHashSchema,
    runtime_attestation_hash: contentHashSchema,
    runs: z.array(falcon24AcceptanceManifestRunSchema).length(30),
  })
  .superRefine(addAcceptanceRunManifestIssues);

export const falcon24AcceptanceRunManifestSchema =
  falcon24AcceptanceRunManifestMaterialSchema.extend({
    manifest_hash: contentHashSchema,
  });

const falcon24AcceptanceRunManifestV2MaterialSchema = z
  .strictObject({
    ...falcon24AcceptanceRunManifestMaterialSchema.shape,
    schema_version: z.literal("falcon24-analysis-run-manifest@3.0.0"),
    authority_epoch: falcon24SuccessorAuthorityEpochSchema,
    campaign_id: falcon24AcceptanceCampaignIdSchema,
  })
  .superRefine(addAcceptanceRunManifestIssues)
  .superRefine((manifest, context) => {
    if (manifest.campaign_id !== campaignIdForEpoch(manifest.authority_epoch)) {
      context.addIssue({
        code: "custom",
        message: "campaign_id 必须与 authority_epoch 派生值一致。",
        path: ["campaign_id"],
      });
    }
  });

export const falcon24AcceptanceRunManifestV2Schema =
  falcon24AcceptanceRunManifestV2MaterialSchema.extend({
    manifest_hash: contentHashSchema,
  });

export const falcon24AcceptanceRunManifestDocumentSchema = z.union([
  falcon24AcceptanceRunManifestSchema,
  falcon24AcceptanceRunManifestV2Schema,
]);

export async function buildFalcon24AcceptanceRunManifest(input: unknown) {
  const material = falcon24AcceptanceRunManifestMaterialSchema.parse(input);
  return falcon24AcceptanceRunManifestSchema.parse({
    ...material,
    manifest_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24AcceptanceRunManifest(input: unknown) {
  const manifest = falcon24AcceptanceRunManifestSchema.parse(input);
  const { manifest_hash: observedHash, ...material } = manifest;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_ANALYSIS_RUN_MANIFEST_HASH_INVALID");
  }
  return manifest;
}

export async function buildFalcon24AcceptanceRunManifestV2(input: unknown) {
  const material = falcon24AcceptanceRunManifestV2MaterialSchema.parse(input);
  return falcon24AcceptanceRunManifestV2Schema.parse({
    ...material,
    manifest_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24AcceptanceRunManifestDocument(input: unknown) {
  const manifest = falcon24AcceptanceRunManifestDocumentSchema.parse(input);
  const { manifest_hash: observedHash, ...material } = manifest;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_ANALYSIS_RUN_MANIFEST_HASH_INVALID");
  }
  return manifest;
}

function addResolutionTraceDetailCountIssue(
  receipt: { detail_closure: readonly unknown[]; detail_count: number },
  context: z.RefinementCtx,
): void {
  if (receipt.detail_closure.length !== receipt.detail_count) {
    context.addIssue({
      code: "custom",
      message: "Falcon24 backend detail closure 必须精确覆盖 detail_count。",
      path: ["detail_closure"],
    });
  }
}

const falcon24ResolutionTraceGateReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-resolution-trace-gate-receipt@2.0.0"),
    campaign_id: falcon24E1GateIdSchema,
    run_id: immutableIdSchema,
    trace_hash: contentHashSchema,
    node_count: z.number().int().positive().safe(),
    edge_count: z.number().int().positive().safe(),
    detail_count: z.number().int().positive().safe(),
    sql_node_count: z.number().int().positive().safe(),
    query_evidence_node_count: z.number().int().positive().safe(),
    analysis_evidence_node_count: z.number().int().positive().safe(),
    chart_node_count: z.number().int().positive().safe(),
    report_node_count: z.number().int().positive().safe(),
    detail_closure: z
      .array(
        z.strictObject({
          node_id: z.string().min(1).max(320),
          detail_hash: contentHashSchema,
        }),
      )
      .min(1)
      .max(20_000)
      .superRefine((items, context) => {
        const identities = items.map(({ node_id: nodeId }) => nodeId);
        if (
          new Set(identities).size !== identities.length ||
          identities.some(
            (identity, index) => index > 0 && identity <= (identities[index - 1] ?? ""),
          )
        ) {
          context.addIssue({
            code: "custom",
            message: "Falcon24 backend detail closure 必须按唯一 node_id 规范升序排列。",
          });
        }
      }),
    verified_at: timestampSchema,
  })
  .superRefine(addResolutionTraceDetailCountIssue);

export const falcon24ResolutionTraceGateReceiptSchema =
  falcon24ResolutionTraceGateReceiptMaterialSchema.extend({
    receipt_hash: contentHashSchema,
  });

const falcon24ResolutionTraceGateReceiptV2MaterialSchema = z
  .strictObject({
    ...falcon24ResolutionTraceGateReceiptMaterialSchema.shape,
    schema_version: z.literal("falcon24-resolution-trace-gate-receipt@3.0.0"),
    authority_epoch: falcon24SuccessorAuthorityEpochSchema,
    campaign_id: falcon24GateIdSchema,
  })
  .superRefine(addResolutionTraceDetailCountIssue)
  .superRefine(addGateEpochIssue);

export const falcon24ResolutionTraceGateReceiptV2Schema =
  falcon24ResolutionTraceGateReceiptV2MaterialSchema.extend({
    receipt_hash: contentHashSchema,
  });

export const falcon24ResolutionTraceGateReceiptDocumentSchema = z.union([
  falcon24ResolutionTraceGateReceiptSchema,
  falcon24ResolutionTraceGateReceiptV2Schema,
]);

export async function buildFalcon24ResolutionTraceGateReceipt(input: unknown) {
  const material = falcon24ResolutionTraceGateReceiptMaterialSchema.parse(input);
  return falcon24ResolutionTraceGateReceiptSchema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24ResolutionTraceGateReceipt(input: unknown) {
  const receipt = falcon24ResolutionTraceGateReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_RESOLUTION_TRACE_GATE_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export async function buildFalcon24ResolutionTraceGateReceiptV2(input: unknown) {
  const material = falcon24ResolutionTraceGateReceiptV2MaterialSchema.parse(input);
  return falcon24ResolutionTraceGateReceiptV2Schema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24ResolutionTraceGateReceiptDocument(input: unknown) {
  const receipt = falcon24ResolutionTraceGateReceiptDocumentSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_RESOLUTION_TRACE_GATE_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

function addResolutionTraceUiGateIssues(
  receipt: {
    opened_nodes: readonly { node_id: string }[];
    opened_artifact_refs: readonly z.infer<typeof artifactReferenceSchema>[];
    chart_ref: z.infer<typeof artifactReferenceSchema>;
    run_id: string;
    workspace_id: string;
  },
  context: z.RefinementCtx,
): void {
  const nodeIds = receipt.opened_nodes.map(({ node_id: nodeId }) => nodeId);
  if (
    new Set(nodeIds).size !== nodeIds.length ||
    nodeIds.some((nodeId, index) => index > 0 && nodeId <= (nodeIds[index - 1] ?? ""))
  ) {
    context.addIssue({
      code: "custom",
      message: "Falcon24 UI opened_nodes 必须按唯一 node_id 规范升序排列。",
      path: ["opened_nodes"],
    });
  }
  const artifactIdentities = receipt.opened_artifact_refs.map(artifactReferenceIdentity);
  if (
    new Set(artifactIdentities).size !== artifactIdentities.length ||
    artifactIdentities.some(
      (identity, index) => index > 0 && identity <= (artifactIdentities[index - 1] ?? ""),
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Falcon24 UI opened_artifact_refs 必须按唯一 exact reference 规范升序排列。",
      path: ["opened_artifact_refs"],
    });
  }
  const artifactTypes = [...receipt.opened_artifact_refs]
    .map(({ artifact_type: artifactType }) => artifactType)
    .sort();
  if (
    artifactTypes.length !== FALCON24_REQUIRED_UI_ARTIFACT_TYPES.length ||
    artifactTypes.some(
      (artifactType, index) => artifactType !== FALCON24_REQUIRED_UI_ARTIFACT_TYPES[index],
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Falcon24 UI 必须精确打开 SQL、查询证据、分析证据、图表与分析报告。",
      path: ["opened_artifact_refs"],
    });
  }
  for (const [index, reference] of receipt.opened_artifact_refs.entries()) {
    if (reference.run_id !== receipt.run_id || reference.tenant_id !== receipt.workspace_id) {
      context.addIssue({
        code: "custom",
        message: "Falcon24 UI Artifact 必须属于同一 Workspace/Run。",
        path: ["opened_artifact_refs", index],
      });
    }
  }
  if (
    receipt.chart_ref.artifact_type !== "ArtifactWorkspaceDocument" ||
    !artifactIdentities.includes(artifactReferenceIdentity(receipt.chart_ref))
  ) {
    context.addIssue({
      code: "custom",
      message: "Falcon24 UI 图表必须是已打开的 exact ArtifactWorkspaceDocument。",
      path: ["chart_ref"],
    });
  }
}

const falcon24ResolutionTraceUiGateReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-resolution-trace-ui-gate-receipt@1.0.0"),
    campaign_id: falcon24E1GateIdSchema,
    run_id: immutableIdSchema,
    workspace_id: immutableIdSchema,
    conversation_id: immutableIdSchema,
    trace_hash: contentHashSchema,
    web_build: z.strictObject({
      build_id: contentHashSchema,
      generation_id: contentHashSchema,
    }),
    browser_harness_version: z.literal("falcon24-agent-browser-trace-gate@1.0.0"),
    opened_nodes: z
      .array(
        z.strictObject({
          node_id: z.string().min(1).max(320),
          detail_hash: contentHashSchema,
        }),
      )
      .min(1)
      .max(20_000),
    opened_artifact_refs: z.array(artifactReferenceSchema).length(5),
    chart_ref: artifactReferenceSchema,
    chart_renderer_version: z.literal("governed-vchart@1.0.0"),
    chart_rendered: z.literal(true),
    source_table_visible: z.literal(true),
    error_banner: z.null(),
    dom_snapshot_hash: contentHashSchema,
    screenshot_hash: contentHashSchema,
    observed_at: timestampSchema,
  })
  .superRefine(addResolutionTraceUiGateIssues);

export const falcon24ResolutionTraceUiGateReceiptSchema =
  falcon24ResolutionTraceUiGateReceiptMaterialSchema.extend({
    receipt_hash: contentHashSchema,
  });

const falcon24ResolutionTraceUiGateReceiptV2MaterialSchema = z
  .strictObject({
    ...falcon24ResolutionTraceUiGateReceiptMaterialSchema.shape,
    schema_version: z.literal("falcon24-resolution-trace-ui-gate-receipt@2.0.0"),
    authority_epoch: falcon24SuccessorAuthorityEpochSchema,
    campaign_id: falcon24GateIdSchema,
  })
  .superRefine(addResolutionTraceUiGateIssues)
  .superRefine(addGateEpochIssue);

export const falcon24ResolutionTraceUiGateReceiptV2Schema =
  falcon24ResolutionTraceUiGateReceiptV2MaterialSchema.extend({
    receipt_hash: contentHashSchema,
  });

export const falcon24ResolutionTraceUiGateReceiptDocumentSchema = z.union([
  falcon24ResolutionTraceUiGateReceiptSchema,
  falcon24ResolutionTraceUiGateReceiptV2Schema,
]);

export async function buildFalcon24ResolutionTraceUiGateReceipt(input: unknown) {
  const material = falcon24ResolutionTraceUiGateReceiptMaterialSchema.parse(input);
  return falcon24ResolutionTraceUiGateReceiptSchema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24ResolutionTraceUiGateReceipt(input: unknown) {
  const receipt = falcon24ResolutionTraceUiGateReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_RESOLUTION_TRACE_UI_GATE_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export async function buildFalcon24ResolutionTraceUiGateReceiptV2(input: unknown) {
  const material = falcon24ResolutionTraceUiGateReceiptV2MaterialSchema.parse(input);
  return falcon24ResolutionTraceUiGateReceiptV2Schema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24ResolutionTraceUiGateReceiptDocument(input: unknown) {
  const receipt = falcon24ResolutionTraceUiGateReceiptDocumentSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_RESOLUTION_TRACE_UI_GATE_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

const falcon24SandboxManagementObservationSummarySchema = z.strictObject({
  active_count: z.number().int().nonnegative().safe(),
  observation_hash: contentHashSchema,
});

const falcon24SandboxManagementObservationMaterialSchema = z.strictObject({
  management_observation_schema_version: z.literal(
    "opensandbox-management-reclamation-observation@1.0.0",
  ),
  management_operation_id: immutableIdSchema,
  observation_source: z.literal("OPENSANDBOX_MANAGEMENT_API"),
  target_metadata_hash: contentHashSchema,
  before_observation: falcon24SandboxManagementObservationSummarySchema,
  killed: z.number().int().nonnegative().safe(),
  after_observation: falcon24SandboxManagementObservationSummarySchema.extend({
    active_count: z.literal(0),
  }),
  residual: z.literal(0),
  completed_at: timestampSchema,
});

export const falcon24SandboxManagementObservationSchema =
  falcon24SandboxManagementObservationMaterialSchema
    .extend({ management_observation_hash: contentHashSchema })
    .superRefine((observation, context) => {
      if (observation.killed !== observation.before_observation.active_count) {
        context.addIssue({
          code: "custom",
          message: "Falcon24 Sandbox 回收数必须与管理面首次观测到的活动 Sandbox 数一致。",
          path: ["killed"],
        });
      }
    });

export async function verifyFalcon24SandboxManagementObservation(input: unknown) {
  const observation = falcon24SandboxManagementObservationSchema.parse(input);
  const { management_observation_hash: observedHash, ...material } = observation;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_SANDBOX_MANAGEMENT_OBSERVATION_HASH_INVALID");
  }
  return observation;
}

const falcon24SandboxReclamationReceiptMaterialSchema = z.strictObject({
  schema_version: z.literal("falcon24-sandbox-reclamation-receipt@2.0.0"),
  campaign_id: falcon24E1GateIdSchema,
  run_id: immutableIdSchema,
  runtime_attestation_hash: contentHashSchema,
  ...falcon24SandboxManagementObservationSchema.shape,
});

function sandboxManagementObservationFromReceipt(
  receipt: z.infer<typeof falcon24SandboxManagementObservationSchema>,
) {
  return {
    management_observation_schema_version: receipt.management_observation_schema_version,
    management_operation_id: receipt.management_operation_id,
    observation_source: receipt.observation_source,
    target_metadata_hash: receipt.target_metadata_hash,
    before_observation: receipt.before_observation,
    killed: receipt.killed,
    after_observation: receipt.after_observation,
    residual: receipt.residual,
    completed_at: receipt.completed_at,
    management_observation_hash: receipt.management_observation_hash,
  };
}

export const falcon24SandboxReclamationReceiptSchema =
  falcon24SandboxReclamationReceiptMaterialSchema.extend({
    receipt_hash: contentHashSchema,
  });

const falcon24SandboxReclamationReceiptV2MaterialSchema = z
  .strictObject({
    ...falcon24SandboxReclamationReceiptMaterialSchema.shape,
    schema_version: z.literal("falcon24-sandbox-reclamation-receipt@3.0.0"),
    authority_epoch: falcon24SuccessorAuthorityEpochSchema,
    campaign_id: falcon24GateIdSchema,
  })
  .superRefine(addGateEpochIssue);

export const falcon24SandboxReclamationReceiptV2Schema =
  falcon24SandboxReclamationReceiptV2MaterialSchema.extend({
    receipt_hash: contentHashSchema,
  });

export const falcon24SandboxReclamationReceiptDocumentSchema = z.union([
  falcon24SandboxReclamationReceiptSchema,
  falcon24SandboxReclamationReceiptV2Schema,
]);

export async function buildFalcon24SandboxReclamationReceipt(input: unknown) {
  const material = falcon24SandboxReclamationReceiptMaterialSchema.parse(input);
  await verifyFalcon24SandboxManagementObservation(
    sandboxManagementObservationFromReceipt(material),
  );
  return falcon24SandboxReclamationReceiptSchema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24SandboxReclamationReceipt(input: unknown) {
  const receipt = falcon24SandboxReclamationReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  await verifyFalcon24SandboxManagementObservation(
    sandboxManagementObservationFromReceipt(material),
  );
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_SANDBOX_RECLAMATION_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export async function buildFalcon24SandboxReclamationReceiptV2(input: unknown) {
  const material = falcon24SandboxReclamationReceiptV2MaterialSchema.parse(input);
  await verifyFalcon24SandboxManagementObservation(
    sandboxManagementObservationFromReceipt(material),
  );
  return falcon24SandboxReclamationReceiptV2Schema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24SandboxReclamationReceiptDocument(input: unknown) {
  const receipt = falcon24SandboxReclamationReceiptDocumentSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  await verifyFalcon24SandboxManagementObservation(
    sandboxManagementObservationFromReceipt(material),
  );
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_SANDBOX_RECLAMATION_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export type Falcon24AcceptanceFailureLayer = z.infer<typeof falcon24AcceptanceFailureLayerSchema>;
export type Falcon24AcceptanceRunManifest = z.infer<typeof falcon24AcceptanceRunManifestSchema>;
export type Falcon24AcceptanceRunManifestV2 = z.infer<typeof falcon24AcceptanceRunManifestV2Schema>;
export type Falcon24ResolutionTraceGateReceipt = z.infer<
  typeof falcon24ResolutionTraceGateReceiptSchema
>;
export type Falcon24ResolutionTraceGateReceiptV2 = z.infer<
  typeof falcon24ResolutionTraceGateReceiptV2Schema
>;
export type Falcon24SandboxReclamationReceipt = z.infer<
  typeof falcon24SandboxReclamationReceiptSchema
>;
export type Falcon24SandboxReclamationReceiptV2 = z.infer<
  typeof falcon24SandboxReclamationReceiptV2Schema
>;
