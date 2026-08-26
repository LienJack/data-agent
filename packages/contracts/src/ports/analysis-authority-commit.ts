import { z } from "zod";
import {
  artifactWorkspaceChartDocumentV3Schema,
  verifyArtifactWorkspaceChartDocumentV3,
} from "../artifacts/export-receipt.js";
import {
  productTeamArtifactDocumentSchema,
  verifyProductTeamArtifactDocument,
} from "../artifacts/product-team-artifact.js";
import { researchArtifactCommitInputSchema } from "../artifacts/research/platform.js";
import {
  analysisProgramRefSchema,
  sandboxExecutionReceiptRefSchema,
  sandboxResultRefSchema,
} from "../artifacts/research/references.js";
import {
  computeL2ResearchEnvelopeContentHash,
  parseL2ResearchDocumentCandidate,
} from "../artifacts/research/wire.js";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
} from "../common/index.js";
import {
  analysisContextJournalAppendCommandSchema,
  verifyAnalysisContextJournalAppend,
} from "./analysis-context-journal.js";
import { analysisOracleReceiptSchema, verifyAnalysisOracleReceipt } from "./analysis-oracle.js";
import { analysisResultStageArtifactSchema } from "./analysis-result-stage.js";
import { analysisAgentFinalResponseSchema } from "./analysis-tools.js";

export const analysisAuthorityOutputBindingSchema = z.strictObject({
  stage_artifact: analysisResultStageArtifactSchema,
  reference: sandboxResultRefSchema,
});

const analysisAuthorityCommitMaterialSchema = z
  .strictObject({
    schema_version: z.literal("analysis-authority-commit@1.0.0"),
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    principal_id: immutableIdSchema,
    node_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u),
    attempt_id: immutableIdSchema,
    worker_fence: z.number().int().positive(),
    idempotency_key: z.string().min(8).max(256),
    analysis_program_ref: analysisProgramRefSchema,
    stage_id: immutableIdSchema,
    stage_hash: contentHashSchema,
    closure_hash: contentHashSchema,
    operator_receipt_closure_hash: contentHashSchema,
    oracle_receipt_payload: z.unknown(),
    oracle_receipt_hash: contentHashSchema,
    explanation: analysisAgentFinalResponseSchema,
    explanation_hash: contentHashSchema,
    output_bindings: z.array(analysisAuthorityOutputBindingSchema).min(3).max(66),
    sandbox_receipt_ref: sandboxExecutionReceiptRefSchema,
    sandbox_receipt_payload: z.record(z.string(), z.unknown()),
    sandbox_receipt_hash: contentHashSchema,
    public_event_id: immutableIdSchema,
  })
  .superRefine((value, context) => {
    const resultCount = value.output_bindings.filter(
      ({ stage_artifact }) => stage_artifact.artifact_kind === "RESULT",
    ).length;
    const tableCount = value.output_bindings.filter(
      ({ stage_artifact }) => stage_artifact.artifact_kind === "TABLE",
    ).length;
    const chartCount = value.output_bindings.filter(
      ({ stage_artifact }) => stage_artifact.artifact_kind === "CHART",
    ).length;
    if (resultCount !== 1 || tableCount < 1 || chartCount < 1) {
      context.addIssue({
        code: "custom",
        path: ["output_bindings"],
        message: "Authority commit requires one RESULT and at least one TABLE and CHART.",
      });
    }
    for (const [index, binding] of value.output_bindings.entries()) {
      const reference = binding.reference;
      if (
        reference.app_id !== value.scope.app_id ||
        reference.tenant_id !== value.scope.tenant_id ||
        reference.environment !== value.scope.environment ||
        reference.run_id !== value.run_id ||
        reference.content_hash !== binding.stage_artifact.content_sha256
      ) {
        context.addIssue({
          code: "custom",
          path: ["output_bindings", index],
          message: "Authority output reference must exactly bind its staged content.",
        });
      }
    }
    if (
      value.sandbox_receipt_ref.app_id !== value.scope.app_id ||
      value.sandbox_receipt_ref.tenant_id !== value.scope.tenant_id ||
      value.sandbox_receipt_ref.environment !== value.scope.environment ||
      value.sandbox_receipt_ref.run_id !== value.run_id ||
      value.sandbox_receipt_ref.content_hash !== value.sandbox_receipt_hash
    ) {
      context.addIssue({
        code: "custom",
        path: ["sandbox_receipt_ref"],
        message: "Sandbox receipt must close over scope, run and payload hash.",
      });
    }
  });

export const analysisAuthorityCommitSchema = analysisAuthorityCommitMaterialSchema.extend({
  authority_commit_hash: contentHashSchema,
});

export const analysisAuthorityCommitReceiptSchema = z.strictObject({
  schema_version: z.literal("analysis-authority-commit-receipt@1.0.0"),
  created: z.boolean(),
  authority_commit_hash: contentHashSchema,
  stage_id: immutableIdSchema,
  stage_hash: contentHashSchema,
  references: z
    .array(z.union([sandboxResultRefSchema, sandboxExecutionReceiptRefSchema]))
    .min(4)
    .max(67),
  public_event_id: immutableIdSchema,
});

export type AnalysisAuthorityCommit = z.infer<typeof analysisAuthorityCommitSchema>;
export type AnalysisAuthorityCommitReceipt = z.infer<typeof analysisAuthorityCommitReceiptSchema>;

async function verifyMaterial(input: unknown) {
  const material = analysisAuthorityCommitMaterialSchema.parse(input);
  if ((await sha256ContentHash(material.oracle_receipt_payload)) !== material.oracle_receipt_hash) {
    throw new TypeError("ANALYSIS_AUTHORITY_ORACLE_RECEIPT_HASH_MISMATCH");
  }
  if ((await sha256ContentHash(material.explanation)) !== material.explanation_hash) {
    throw new TypeError("ANALYSIS_AUTHORITY_EXPLANATION_HASH_MISMATCH");
  }
  if (
    (await sha256ContentHash(material.sandbox_receipt_payload)) !== material.sandbox_receipt_hash
  ) {
    throw new TypeError("ANALYSIS_AUTHORITY_SANDBOX_RECEIPT_HASH_MISMATCH");
  }
  return material;
}

export async function buildAnalysisAuthorityCommit(
  input: z.input<typeof analysisAuthorityCommitMaterialSchema>,
): Promise<AnalysisAuthorityCommit> {
  const material = await verifyMaterial(input);
  return deepFreeze(
    analysisAuthorityCommitSchema.parse({
      ...material,
      authority_commit_hash: await sha256ContentHash({
        hash_domain: "analysis-authority-commit@1.0.0",
        value: material,
      }),
    }),
  );
}

export async function verifyAnalysisAuthorityCommit(
  input: unknown,
): Promise<AnalysisAuthorityCommit> {
  const command = analysisAuthorityCommitSchema.parse(input);
  const { authority_commit_hash: observedHash, ...materialInput } = command;
  const material = await verifyMaterial(materialInput);
  const expectedHash = await sha256ContentHash({
    hash_domain: "analysis-authority-commit@1.0.0",
    value: material,
  });
  if (observedHash !== expectedHash) {
    throw new TypeError("ANALYSIS_AUTHORITY_COMMIT_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

const e1AnalysisPublicationNodeSchema = z
  .strictObject({
    authority_commit: analysisAuthorityCommitSchema,
    journal_command: analysisContextJournalAppendCommandSchema,
    oracle_receipt: analysisOracleReceiptSchema,
  })
  .superRefine((node, context) => {
    const command = node.authority_commit;
    const journal = node.journal_command;
    const oracle = node.oracle_receipt;
    if (
      journal.event.event_type !== "AUTHORITY_COMMITTED" ||
      journal.event.stage_id !== command.stage_id ||
      journal.event.authority_commit_hash !== command.authority_commit_hash ||
      oracle.verdict !== "PASS" ||
      oracle.expected_terminal !== "READY" ||
      oracle.run_id !== command.run_id ||
      oracle.node_id !== command.node_id ||
      oracle.input_binding.stage_id !== command.stage_id ||
      oracle.input_binding.stage_hash !== command.stage_hash ||
      oracle.input_binding.published_closure_hash !== command.closure_hash ||
      oracle.input_binding.operator_receipt_closure_hash !== command.operator_receipt_closure_hash
    ) {
      context.addIssue({
        code: "custom",
        message: "Publication node must close one Oracle-approved authority stage.",
      });
    }
  });

const e1AnalysisPublicationMaterialSchema = z
  .strictObject({
    schema_version: z.literal("e1-analysis-publication@1.0.0"),
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    principal_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    worker_fence: z.number().int().positive(),
    idempotency_key: z.string().min(8).max(256),
    analysis_program_ref: analysisProgramRefSchema,
    nodes: z.array(e1AnalysisPublicationNodeSchema).min(1).max(64),
    l2_artifact_commands: z.array(researchArtifactCommitInputSchema).min(2).max(65),
    chart_documents: z.array(artifactWorkspaceChartDocumentV3Schema).min(1).max(32),
    report_document: productTeamArtifactDocumentSchema,
    public_event_id: immutableIdSchema,
  })
  .superRefine((publication, context) => {
    const sameScopeAndRun = (value: {
      readonly app_id: string;
      readonly tenant_id: string;
      readonly environment: string;
      readonly run_id: string;
    }) =>
      value.app_id === publication.scope.app_id &&
      value.tenant_id === publication.scope.tenant_id &&
      value.environment === publication.scope.environment &&
      value.run_id === publication.run_id;
    const nodeIds = publication.nodes.map(({ authority_commit: command }) => command.node_id);
    const derivedCommands = publication.l2_artifact_commands.filter(
      ({ candidate }) => candidate.payload.artifact_type === "DerivedAnalysisEvidence",
    );
    const completionCommands = publication.l2_artifact_commands.filter(
      ({ candidate }) => candidate.payload.artifact_type === "AnalysisCompletionReceipt",
    );
    const completion = completionCommands[0]?.candidate.payload;
    if (
      new Set(nodeIds).size !== nodeIds.length ||
      derivedCommands.length !== publication.nodes.length ||
      completionCommands.length !== 1 ||
      completion?.artifact_type !== "AnalysisCompletionReceipt" ||
      completion.terminal !== "READY" ||
      publication.l2_artifact_commands.some(
        (command) =>
          command.run_id !== publication.run_id ||
          command.principal_id !== publication.principal_id ||
          command.attempt_id !== publication.attempt_id ||
          command.worker_fence !== publication.worker_fence ||
          !sameScopeAndRun(command.candidate.envelope),
      ) ||
      publication.nodes.some(
        ({ authority_commit: command }) =>
          command.run_id !== publication.run_id ||
          command.principal_id !== publication.principal_id ||
          command.attempt_id !== publication.attempt_id ||
          command.worker_fence !== publication.worker_fence ||
          !sameScopeAndRun({ ...command.scope, run_id: command.run_id }),
      ) ||
      publication.chart_documents.some(
        ({ document_ref: reference }) => !sameScopeAndRun(reference),
      ) ||
      !sameScopeAndRun(publication.report_document.artifact_ref) ||
      publication.analysis_program_ref.run_id !== publication.run_id ||
      !sameScopeAndRun(publication.analysis_program_ref)
    ) {
      context.addIssue({
        code: "custom",
        message: "E1 publication must contain an exact READY all-node bundle for one fence.",
      });
    }
    const evidenceNodeIds = new Set(
      derivedCommands.flatMap(({ candidate }) =>
        candidate.payload.artifact_type === "DerivedAnalysisEvidence"
          ? [candidate.payload.node_id]
          : [],
      ),
    );
    if (nodeIds.some((nodeId) => !evidenceNodeIds.has(nodeId))) {
      context.addIssue({
        code: "custom",
        path: ["l2_artifact_commands"],
        message: "Every published node must have exactly one DerivedAnalysisEvidence.",
      });
    }
  });

export const e1AnalysisPublicationCommandSchema = e1AnalysisPublicationMaterialSchema.extend({
  publication_hash: contentHashSchema,
});

export const e1AnalysisPublicationReceiptSchema = z.strictObject({
  schema_version: z.literal("e1-analysis-publication-receipt@1.0.0"),
  created: z.boolean(),
  publication_hash: contentHashSchema,
  public_event_id: immutableIdSchema,
  references: z
    .array(
      z.union([
        sandboxResultRefSchema,
        sandboxExecutionReceiptRefSchema,
        z
          .object({
            artifact_id: immutableIdSchema,
            artifact_type: z.string().min(2).max(127),
            app_id: immutableIdSchema,
            tenant_id: immutableIdSchema,
            environment: z.string().min(1).max(64),
            run_id: immutableIdSchema,
            revision: z.number().int().positive(),
            content_hash: contentHashSchema,
          })
          .strict(),
      ]),
    )
    .min(7)
    .max(256),
});

export type E1AnalysisPublicationCommand = z.infer<typeof e1AnalysisPublicationCommandSchema>;
export type E1AnalysisPublicationReceipt = z.infer<typeof e1AnalysisPublicationReceiptSchema>;

async function verifyE1PublicationMaterial(input: unknown) {
  const material = e1AnalysisPublicationMaterialSchema.parse(input);
  await Promise.all(
    material.nodes.map(async (node) => {
      await Promise.all([
        verifyAnalysisAuthorityCommit(node.authority_commit),
        verifyAnalysisContextJournalAppend(node.journal_command),
        verifyAnalysisOracleReceipt(node.oracle_receipt),
      ]);
      const durableOracle = z
        .strictObject({ oracle_receipt: analysisOracleReceiptSchema.nullable() })
        .passthrough()
        .parse(node.authority_commit.oracle_receipt_payload);
      if (
        !durableOracle.oracle_receipt ||
        durableOracle.oracle_receipt.receipt_hash !== node.oracle_receipt.receipt_hash
      ) {
        throw new TypeError("E1_ANALYSIS_PUBLICATION_ORACLE_CLOSURE_MISMATCH");
      }
    }),
  );
  await Promise.all(
    material.l2_artifact_commands.map(async ({ candidate }) => {
      const document = parseL2ResearchDocumentCandidate(candidate);
      if (
        (await computeL2ResearchEnvelopeContentHash(document)) !== document.envelope.content_hash
      ) {
        throw new TypeError("E1_ANALYSIS_PUBLICATION_L2_HASH_MISMATCH");
      }
    }),
  );
  await Promise.all([
    ...material.chart_documents.map(verifyArtifactWorkspaceChartDocumentV3),
    verifyProductTeamArtifactDocument(material.report_document),
  ]);
  return material;
}

export async function buildE1AnalysisPublicationCommand(
  input: z.input<typeof e1AnalysisPublicationMaterialSchema>,
): Promise<E1AnalysisPublicationCommand> {
  const material = await verifyE1PublicationMaterial(input);
  return deepFreeze(
    e1AnalysisPublicationCommandSchema.parse({
      ...material,
      publication_hash: await sha256ContentHash({
        hash_domain: "e1-analysis-publication@1.0.0",
        value: material,
      }),
    }),
  );
}

export async function verifyE1AnalysisPublicationCommand(
  input: unknown,
): Promise<E1AnalysisPublicationCommand> {
  const command = e1AnalysisPublicationCommandSchema.parse(input);
  const { publication_hash: observedHash, ...materialInput } = command;
  const material = await verifyE1PublicationMaterial(materialInput);
  const expectedHash = await sha256ContentHash({
    hash_domain: "e1-analysis-publication@1.0.0",
    value: material,
  });
  if (observedHash !== expectedHash) {
    throw new TypeError("E1_ANALYSIS_PUBLICATION_HASH_MISMATCH");
  }
  return deepFreeze(command);
}
