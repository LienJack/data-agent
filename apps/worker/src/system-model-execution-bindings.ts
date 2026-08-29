import {
  createModelProviderBindings,
  createModelProviderExecutionBinding,
  getModelProviderBinding,
  type ModelProviderExecutionBinding,
  SYSTEM_MODEL_DEPLOYMENT_OVERRIDES,
} from "@data-agent/agent-runtime";
import type { Pool } from "pg";

interface ExecutionCatalogRow {
  readonly provider: "deepseek" | "kimi";
  readonly model_profile_id: string;
  readonly config_version: string | number;
  readonly model_id: string;
  readonly resource_hash: `sha256:${string}`;
  readonly deployment_hash: `sha256:${string}`;
}

export interface SystemModelExecutionBindingRecord {
  readonly binding: ModelProviderExecutionBinding;
  readonly model_resource_hash: `sha256:${string}`;
}

export async function loadSystemModelExecutionBindingRecords(
  pool: Pool,
  deploymentId: string,
): Promise<readonly SystemModelExecutionBindingRecord[]> {
  const baseBindings = createModelProviderBindings(SYSTEM_MODEL_DEPLOYMENT_OVERRIDES);
  const rows = await pool.query<ExecutionCatalogRow>(
    `select catalog.provider,
            catalog.model_profile_id,
            catalog.config_version,
            catalog.model_id,
            platform.canonical_sha256(revision.snapshot) as resource_hash,
            app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
              'deployment_id',deployment.deployment_id,
              'app_id',deployment.app_id,
              'environment',deployment.environment,
              'deployment_key_hash',deployment.deployment_key_hash
            )) as deployment_hash
       from app_data_agent.model_catalog_entries catalog
       join app_data_agent.model_config_versions revision
         on revision.app_id=catalog.app_id
        and revision.environment=catalog.environment
        and revision.model_profile_id=catalog.model_profile_id
        and revision.config_version=catalog.config_version
       join platform.deployment_mappings deployment
         on deployment.deployment_id=$1::uuid
        and deployment.app_id=catalog.app_id
        and deployment.environment=catalog.environment
        and deployment.is_active
      where catalog.is_system_default
        and catalog.provider in ('deepseek','kimi')
        and catalog.status = 'ACTIVE'
      order by catalog.provider`,
    [deploymentId],
  );
  return rows.rows.map((row) => {
    const template = getModelProviderBinding(row.provider, baseBindings);
    const configVersion = Number(row.config_version);
    return Object.freeze({
      model_resource_hash: row.resource_hash,
      binding: createModelProviderExecutionBinding({
        template: { ...template, profile_id: row.model_profile_id },
        model_config_version: configVersion,
        model_id: row.model_id,
        model_resource_hash: row.resource_hash,
        execution_profile_hash: row.resource_hash,
        recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
        connection: {
          kind: "SYSTEM_DEPLOYMENT",
          deployment_id: deploymentId,
          deployment_revision: 1,
          deployment_hash: row.deployment_hash,
        },
        operational_constraints: template.operational_constraints,
      }),
    });
  });
}

export async function loadSystemModelExecutionBindings(
  pool: Pool,
  deploymentId: string,
): Promise<readonly ModelProviderExecutionBinding[]> {
  return (await loadSystemModelExecutionBindingRecords(pool, deploymentId)).map(
    ({ binding }) => binding,
  );
}
