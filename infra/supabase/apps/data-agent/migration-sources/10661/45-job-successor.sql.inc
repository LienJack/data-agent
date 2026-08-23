alter table app_data_agent.job_handler_revisions drop constraint job_handler_revisions_kind_check;
alter table app_data_agent.job_handler_revisions add constraint job_handler_revisions_kind_check check (kind in (
  'SCHEMA_SCAN','RELATIONSHIP_INDEX','ARTIFACT_EXPORT','SEMANTIC_INDUCTION','METRIC_IMPORT',
  'DATALINK_REBUILD','FILE_SCAN','KNOWLEDGE_INDEX'
));
alter table app_data_agent.jobs drop constraint jobs_kind_check;
alter table app_data_agent.jobs add constraint jobs_kind_check check (kind in (
  'SCHEMA_SCAN','RELATIONSHIP_INDEX','ARTIFACT_EXPORT','SEMANTIC_INDUCTION','METRIC_IMPORT',
  'DATALINK_REBUILD','FILE_SCAN','KNOWLEDGE_INDEX'
));
insert into app_data_agent.job_handler_revisions(
  kind,handler_revision,enabled,dependencies_ready,output_receipt_required
) values ('KNOWLEDGE_INDEX','knowledge-index-handler@1.0.0',true,true,true);

create or replace function app_data_agent.assert_job_artifact_references(
  requested_references jsonb,requested_app_id uuid,requested_tenant_id uuid,requested_environment text
)
returns void language plpgsql security definer set search_path=''
as $function$
declare reference jsonb; identity text; previous_identity text;
begin
  if pg_catalog.jsonb_typeof(requested_references)<>'array'
    or pg_catalog.jsonb_array_length(requested_references)>64
  then raise exception using errcode='22023',message='JOB_OUTPUT_REFERENCES_INVALID'; end if;
  for reference in select value from pg_catalog.jsonb_array_elements(requested_references) loop
    if reference ? 'artifact_type' then
      if not app_data_agent.provider_json_object_has_exact_keys(reference,array[
          'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
        ]) or reference->>'app_id'<>requested_app_id::text
        or reference->>'tenant_id'<>requested_tenant_id::text
        or reference->>'environment'<>requested_environment
        or not exists (
          select 1 from app_data_agent.artifacts artifact
          where artifact.app_id=requested_app_id and artifact.tenant_id=requested_tenant_id
            and artifact.environment=requested_environment
            and artifact.run_id=(reference->>'run_id')::uuid
            and artifact.artifact_id=(reference->>'artifact_id')::uuid
            and artifact.artifact_type=reference->>'artifact_type'
            and artifact.revision=(reference->>'revision')::integer
            and artifact.content_hash=reference->>'content_hash' and artifact.is_active
        )
      then raise exception using errcode='23503',message='JOB_ARTIFACT_NOT_COMMITTED'; end if;
      identity:='ARTIFACT:'||reference::text;
    else
      if not app_data_agent.provider_json_object_has_exact_keys(reference,array[
          'schema_version','resource_kind','app_id','tenant_id','environment','resource_id',
          'resource_revision','resource_hash'
        ]) or reference->>'schema_version'<>'job-domain-output-reference@1.0.0'
        or reference->>'resource_kind' not in ('WORKSPACE_FILE_SCAN_RECEIPT','KNOWLEDGE_INDEX_GENERATION')
        or reference->>'app_id'<>requested_app_id::text
        or reference->>'tenant_id'<>requested_tenant_id::text
        or reference->>'environment'<>requested_environment
        or reference->>'resource_hash'!~'^sha256:[0-9a-f]{64}$'
      then raise exception using errcode='23503',message='JOB_DOMAIN_OUTPUT_NOT_COMMITTED'; end if;
      if reference->>'resource_kind'='WORKSPACE_FILE_SCAN_RECEIPT' and not exists (
        select 1 from app_data_agent.workspace_file_scan_receipts receipt
        where receipt.app_id=requested_app_id and receipt.tenant_id=requested_tenant_id
          and receipt.environment=requested_environment
          and receipt.receipt_id=(reference->>'resource_id')::uuid
          and receipt.receipt_hash=reference->>'resource_hash'
      ) then raise exception using errcode='23503',message='JOB_DOMAIN_OUTPUT_NOT_COMMITTED'; end if;
      if reference->>'resource_kind'='KNOWLEDGE_INDEX_GENERATION' and not exists (
        select 1 from app_data_agent.knowledge_index_generations generation
        where generation.app_id=requested_app_id and generation.tenant_id=requested_tenant_id
          and generation.environment=requested_environment
          and generation.generation_id=(reference->>'resource_id')::uuid
          and generation.generation_revision=(reference->>'resource_revision')::bigint
          and generation.generation_hash=reference->>'resource_hash' and generation.state='READY'
      ) then raise exception using errcode='23503',message='JOB_DOMAIN_OUTPUT_NOT_COMMITTED'; end if;
      identity:='DOMAIN:'||pg_catalog.jsonb_build_array(
        reference->>'app_id',reference->>'tenant_id',reference->>'environment',
        reference->>'resource_kind',reference->>'resource_id',
        (reference->>'resource_revision')::bigint,reference->>'resource_hash'
      )::text;
    end if;
    if previous_identity is not null and previous_identity>=identity then
      raise exception using errcode='22023',message='JOB_OUTPUT_REFERENCES_NOT_CANONICAL'; end if;
    previous_identity:=identity;
  end loop;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='JOB_OUTPUT_REFERENCES_INVALID';
end
$function$;
