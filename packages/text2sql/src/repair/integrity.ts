import { sha256ContentHash } from "@data-agent/contracts";
import type {
  RepairFrozenBundle,
  RepairFrozenBundleInput,
  RepairPatchOperation,
  RepairReceipt,
  RepairTraceData,
} from "./types.js";

export async function computeRepairFrozenBundleHash(
  input: RepairFrozenBundleInput | RepairFrozenBundle,
): Promise<`sha256:${string}`> {
  const { frozen_bundle_hash: _bundleHash, ...material } = input as RepairFrozenBundle;
  return sha256ContentHash(material);
}

export async function computeRepairEpisodeHash(
  input: RepairFrozenBundleInput | RepairFrozenBundle,
): Promise<`sha256:${string}`> {
  const {
    repair_id: _repairId,
    principal_id: _principalId,
    query_contract_ref: queryContractReference,
    grounding_package_ref: _groundingPackageReference,
    semantic_query_ref: _semanticQueryReference,
    logical_plan_ref: _logicalPlanReference,
    root_sql_artifact_ref: _rootSqlArtifactReference,
    root_sql_artifact_payload_hash: _rootSqlArtifactPayloadHash,
    episode_hash: _episodeHash,
    frozen_bundle_hash: _bundleHash,
    ...stableProblemMaterial
  } = input as RepairFrozenBundle;
  return sha256ContentHash({
    scope: {
      app_id: queryContractReference.app_id,
      tenant_id: queryContractReference.tenant_id,
      environment: queryContractReference.environment,
      run_id: queryContractReference.run_id,
    },
    ...stableProblemMaterial,
  });
}

export async function computeRepairPatchScriptHash(
  patchOperations: readonly RepairPatchOperation[],
): Promise<`sha256:${string}`> {
  return sha256ContentHash(patchOperations);
}

export async function computeRepairReceiptHash(
  input: Omit<RepairReceipt, "receipt_hash"> | RepairReceipt,
): Promise<`sha256:${string}`> {
  const { receipt_hash: _receiptHash, ...material } = input as RepairReceipt;
  return sha256ContentHash(material);
}

export async function computeRepairTraceHash(
  input: Omit<RepairTraceData, "trace_hash"> | RepairTraceData,
): Promise<`sha256:${string}`> {
  const { trace_hash: _traceHash, ...material } = input as RepairTraceData;
  return sha256ContentHash(material);
}
