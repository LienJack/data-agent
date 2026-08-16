create function app_data_agent.resolve_conversation_run_selections(
  requested_conversation_id uuid,
  requested_expected_resource_version bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  conversation_record app_data_agent.qa_conversations%rowtype;
  datasource_record app_data_agent.datasource_connections%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested_conversation_id is null
    or requested_expected_resource_version is null
    or requested_expected_resource_version not between 1 and 9007199254740991
  then
    raise exception using errcode = '22023', message = 'CONVERSATION_RUN_SELECTION_INPUT_INVALID';
  end if;

  select * into strict authority from platform.current_backend_authority(false);
  select conversation.* into conversation_record
  from app_data_agent.qa_conversations as conversation
  where conversation.app_id = authority.app_id
    and conversation.tenant_id = authority.tenant_id
    and conversation.environment = authority.environment
    and conversation.owner_principal_id = authority.principal_id
    and conversation.conversation_id = requested_conversation_id
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'CONVERSATION_RUN_SELECTION_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if conversation_record.resource_version <> requested_expected_resource_version then
    raise exception using errcode = '40001', message = 'CONVERSATION_RUN_SELECTION_VERSION_CONFLICT';
  end if;
  if conversation_record.model_profile_id is null then
    raise exception using errcode = '55000', message = 'PROVIDER_PROFILE_NOT_AVAILABLE';
  end if;
  if conversation_record.datasource_id is null then
    raise exception using errcode = '55000', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
  end if;

  select datasource.* into datasource_record
  from app_data_agent.datasource_connections as datasource
  where datasource.app_id = authority.app_id
    and datasource.tenant_id = authority.tenant_id
    and datasource.environment = authority.environment
    and datasource.datasource_id = conversation_record.datasource_id
    and datasource.status = 'ACTIVE'
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
  end if;

  select catalog.* into model_record
  from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = authority.app_id
    and catalog.environment = authority.environment
    and catalog.model_profile_id = conversation_record.model_profile_id
    and catalog.status not in ('DRAFT','DISABLED')
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_PROFILE_NOT_AVAILABLE';
  end if;
  perform 1
  from app_data_agent.model_config_versions as revision
  where revision.app_id = model_record.app_id
    and revision.environment = model_record.environment
    and revision.model_profile_id = model_record.model_profile_id
    and revision.config_version = model_record.config_version;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_PROFILE_NOT_AVAILABLE';
  end if;

  return pg_catalog.jsonb_build_object(
    'schema_version','conversation-run-selections@1.0.0',
    'conversation_id',conversation_record.conversation_id,
    'conversation_resource_version',conversation_record.resource_version,
    'model_profile_id',model_record.model_profile_id,
    'model_config_version',model_record.config_version,
    'datasource_id',datasource_record.datasource_id,
    'datasource_resource_version',datasource_record.resource_version
  );
end
$function$;

create function app_data_agent.list_provider_execution_profiles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  authority record;
  profile record;
  certification app_data_agent.artifacts%rowtype;
  managed_connection app_data_agent.model_provider_connections%rowtype;
  managed_revision app_data_agent.model_provider_connection_versions%rowtype;
  deployment platform.deployment_mappings%rowtype;
  profiles jsonb := '[]'::jsonb;
  common_document jsonb;
  readiness text;
  unavailable_reason text;
  connection_available boolean;
  resource_hash text;
  expected_connection_hash text;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  for profile in
    select catalog.*, revision.snapshot
    from app_data_agent.model_catalog_entries catalog
    left join app_data_agent.model_config_versions revision
      on revision.app_id = catalog.app_id
     and revision.environment = catalog.environment
     and revision.model_profile_id = catalog.model_profile_id
     and revision.config_version = catalog.config_version
    where catalog.app_id = authority.app_id
      and catalog.environment = authority.environment
    order by pg_catalog.lower(catalog.display_name),catalog.model_profile_id
    limit 256
  loop
    resource_hash := case when profile.snapshot is null then null
      else app_data_agent.u2_canonical_sha256(profile.snapshot) end;
    common_document := pg_catalog.jsonb_build_object(
      'model_profile_id',profile.model_profile_id,
      'model_config_version',profile.config_version,
      'resource_hash',coalesce(resource_hash,app_data_agent.u2_canonical_sha256('null'::jsonb)),
      'profile_version','model-profile@' || profile.config_version::text,
      'provider',profile.provider,'model_id',profile.model_id,'display_name',profile.display_name);
    readiness := null;
    unavailable_reason := null;
    if profile.status in ('DRAFT','DISABLED') then
      readiness := 'DISABLED'; unavailable_reason := 'MODEL_PROFILE_DISABLED';
    elsif profile.snapshot is null then
      readiness := 'STALE'; unavailable_reason := 'MODEL_PROFILE_STALE';
    end if;

    select artifact.* into certification
    from app_data_agent.artifacts artifact
    where artifact.app_id = authority.app_id
      and artifact.tenant_id = authority.tenant_id
      and artifact.environment = authority.environment
      and artifact.artifact_type = 'ModelCertificationReceipt'
      and artifact.is_active
      and artifact.document_json ->> 'profile_id' = profile.model_profile_id::text
      and artifact.document_json ->> 'model_config_version' = profile.config_version::text
      and artifact.document_json ->> 'provider' = profile.provider
      and artifact.document_json ->> 'model_id' = profile.model_id
      and app_data_agent.provider_json_object_has_exact_keys(artifact.document_json,array[
        'schema_version','receipt_ref','profile_id','model_config_version','provider','model_id',
        'profile_version','adapter_version','execution_profile_hash','execution_profile_snapshot',
        'recovery_capabilities','connection','certification_basis','verdict'
      ]::text[])
      and app_data_agent.provider_json_object_has_exact_keys(
        artifact.document_json -> 'receipt_ref',array[
          'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision',
          'content_hash'
        ]::text[])
      and app_data_agent.provider_json_object_has_exact_keys(
        artifact.document_json -> 'execution_profile_snapshot',array[
          'profile_id','scope','provider','model_id','model_config_version','profile_version',
          'adapter_version','recovery_capabilities','connection','capabilities','context_window',
          'region_privacy','fallback_compatibility'
        ]::text[])
      and app_data_agent.provider_json_object_has_exact_keys(
        artifact.document_json #> '{execution_profile_snapshot,context_window}',array[
          'verification_status','max_context_tokens','max_output_tokens'
        ]::text[])
      and artifact.content_hash =
        app_data_agent.u2_canonical_sha256(artifact.document_json #- '{receipt_ref,content_hash}')
      and artifact.document_json #>> '{receipt_ref,content_hash}' = artifact.content_hash
      and artifact.document_json ->> 'schema_version' = 'model-execution-certification@1.0.0'
      and artifact.document_json ->> 'verdict' = 'PASS'
      and artifact.document_json ->> 'profile_version' =
        'model-profile@' || profile.config_version::text
      and artifact.document_json ->> 'adapter_version' ~
        '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
      and artifact.document_json #>>
        '{execution_profile_snapshot,context_window,max_context_tokens}' ~ '^[1-9][0-9]*$'
      and artifact.document_json #>>
        '{execution_profile_snapshot,context_window,max_output_tokens}' ~ '^[1-9][0-9]*$'
      and artifact.document_json -> 'recovery_capabilities' in (
        '["IDEMPOTENT_REQUEST"]'::jsonb,
        '["INVOCATION_STATUS_QUERY"]'::jsonb,
        '["INVOCATION_RECONCILIATION"]'::jsonb,
        '["AT_LEAST_ONCE_ONLY"]'::jsonb,
        '["IDEMPOTENT_REQUEST","INVOCATION_STATUS_QUERY"]'::jsonb,
        '["IDEMPOTENT_REQUEST","INVOCATION_RECONCILIATION"]'::jsonb,
        '["INVOCATION_STATUS_QUERY","INVOCATION_RECONCILIATION"]'::jsonb,
        '["IDEMPOTENT_REQUEST","INVOCATION_STATUS_QUERY","INVOCATION_RECONCILIATION"]'::jsonb
      )
      and artifact.document_json -> 'recovery_capabilities' =
        artifact.document_json #> '{execution_profile_snapshot,recovery_capabilities}'
      and artifact.document_json -> 'connection' =
        artifact.document_json #> '{execution_profile_snapshot,connection}'
      and artifact.document_json -> 'receipt_ref' = pg_catalog.jsonb_build_object(
        'artifact_id',artifact.artifact_id,'artifact_type','ModelCertificationReceipt',
        'app_id',artifact.app_id,'tenant_id',artifact.tenant_id,
        'environment',artifact.environment,'run_id',artifact.run_id,
        'revision',artifact.revision,'content_hash',artifact.content_hash)
      and artifact.document_json ->> 'execution_profile_hash' =
        app_data_agent.u2_canonical_sha256(artifact.document_json -> 'execution_profile_snapshot')
      and artifact.document_json #> '{execution_profile_snapshot,capabilities}' =
        profile.capabilities
    order by artifact.created_at desc,artifact.artifact_id
    limit 1;
    if readiness is null and certification.artifact_id is null then
      readiness := 'CERTIFICATION_REQUIRED';
      unavailable_reason := 'MODEL_CERTIFICATION_REQUIRED';
    elsif readiness is null and (
      not app_data_agent.provider_json_object_has_exact_keys(certification.document_json,array[
        'schema_version','receipt_ref','profile_id','model_config_version','provider','model_id',
        'profile_version','adapter_version','execution_profile_hash','execution_profile_snapshot',
        'recovery_capabilities','connection','certification_basis','verdict'
      ]::text[])
      or not app_data_agent.provider_json_object_has_exact_keys(
        certification.document_json -> 'receipt_ref',array[
          'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision',
          'content_hash'
        ]::text[])
      or not app_data_agent.provider_json_object_has_exact_keys(
        certification.document_json -> 'execution_profile_snapshot',array[
          'profile_id','scope','provider','model_id','model_config_version','profile_version',
          'adapter_version','recovery_capabilities','connection','capabilities','context_window',
          'region_privacy','fallback_compatibility'
        ]::text[])
      or not app_data_agent.provider_json_object_has_exact_keys(
        certification.document_json #> '{execution_profile_snapshot,context_window}',array[
          'verification_status','max_context_tokens','max_output_tokens'
        ]::text[])
      or certification.content_hash <>
        app_data_agent.u2_canonical_sha256(certification.document_json #- '{receipt_ref,content_hash}')
      or certification.document_json #>> '{receipt_ref,content_hash}' <> certification.content_hash
      or certification.document_json ->> 'schema_version' <>
        'model-execution-certification@1.0.0'
      or certification.document_json ->> 'verdict' <> 'PASS'
      or certification.document_json ->> 'profile_version' <>
        'model-profile@' || profile.config_version::text
      or certification.document_json ->> 'profile_id' <> profile.model_profile_id::text
      or certification.document_json ->> 'model_config_version' <> profile.config_version::text
      or certification.document_json ->> 'provider' <> profile.provider
      or certification.document_json ->> 'model_id' <> profile.model_id
      or certification.document_json ->> 'adapter_version' !~
        '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
      or certification.document_json #>>
        '{execution_profile_snapshot,context_window,max_context_tokens}' !~ '^[1-9][0-9]*$'
      or certification.document_json #>>
        '{execution_profile_snapshot,context_window,max_output_tokens}' !~ '^[1-9][0-9]*$'
      or certification.document_json -> 'recovery_capabilities' not in (
        '["IDEMPOTENT_REQUEST"]'::jsonb,
        '["INVOCATION_STATUS_QUERY"]'::jsonb,
        '["INVOCATION_RECONCILIATION"]'::jsonb,
        '["AT_LEAST_ONCE_ONLY"]'::jsonb,
        '["IDEMPOTENT_REQUEST","INVOCATION_STATUS_QUERY"]'::jsonb,
        '["IDEMPOTENT_REQUEST","INVOCATION_RECONCILIATION"]'::jsonb,
        '["INVOCATION_STATUS_QUERY","INVOCATION_RECONCILIATION"]'::jsonb,
        '["IDEMPOTENT_REQUEST","INVOCATION_STATUS_QUERY","INVOCATION_RECONCILIATION"]'::jsonb
      )
      or certification.document_json -> 'recovery_capabilities' <>
        certification.document_json #> '{execution_profile_snapshot,recovery_capabilities}'
      or certification.document_json -> 'connection' <>
        certification.document_json #> '{execution_profile_snapshot,connection}'
      or certification.document_json -> 'receipt_ref' <> pg_catalog.jsonb_build_object(
        'artifact_id',certification.artifact_id,'artifact_type','ModelCertificationReceipt',
        'app_id',certification.app_id,'tenant_id',certification.tenant_id,
        'environment',certification.environment,'run_id',certification.run_id,
        'revision',certification.revision,'content_hash',certification.content_hash)
      or certification.document_json ->> 'execution_profile_hash' <>
        app_data_agent.u2_canonical_sha256(certification.document_json -> 'execution_profile_snapshot')
      or certification.document_json #> '{execution_profile_snapshot,capabilities}' <>
        profile.capabilities
    ) then
      readiness := 'STALE'; unavailable_reason := 'MODEL_PROFILE_STALE';
    elsif readiness is null and certification.document_json #>>
      '{execution_profile_snapshot,context_window,verification_status}' <> 'VERIFIED' then
      readiness := 'CONTEXT_WINDOW_UNVERIFIED';
      unavailable_reason := 'MODEL_CONTEXT_WINDOW_UNVERIFIED';
    elsif readiness is null and (
      profile.provider <> 'deepseek'
      or certification.document_json -> 'recovery_capabilities' <>
        '["AT_LEAST_ONCE_ONLY"]'::jsonb
      or certification.document_json #>> '{connection,kind}' <> 'SYSTEM_DEPLOYMENT'
      or certification.document_json #>> '{connection,deployment_id}' <>
        authority.deployment_id::text
    ) then
      -- U3 only installs an operational recovery driver for the exact DeepSeek
      -- AT_LEAST_ONCE_ONLY profile. Keep other certified capability claims visible
      -- for diagnosis, but never project them as executable until their driver ships.
      readiness := 'STALE';
      unavailable_reason := 'MODEL_PROFILE_STALE';
    end if;

    if readiness is null then
      connection_available := false;
      if certification.document_json #>> '{connection,kind}' = 'MANAGED_CONNECTION' then
        if app_data_agent.provider_json_object_has_exact_keys(
          certification.document_json -> 'connection',array[
            'kind','provider_connection_id','config_version','connection_hash'
          ]::text[])
          and certification.document_json #>> '{connection,provider_connection_id}' ~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and certification.document_json #>> '{connection,config_version}' ~ '^[1-9][0-9]*$'
        then
          select connection.* into managed_connection
          from app_data_agent.model_provider_connections connection
          where connection.app_id = authority.app_id
            and connection.environment = authority.environment
            and connection.provider_connection_id = profile.provider_connection_id
            and connection.provider_connection_id =
              (certification.document_json #>> '{connection,provider_connection_id}')::uuid
            and connection.config_version =
              (certification.document_json #>> '{connection,config_version}')::bigint
            and connection.runtime_provider = profile.provider
            and connection.status = 'ACTIVE'
            and connection.credential_ref ->> 'rotation_state' = 'ACTIVE';
          select revision.* into managed_revision
          from app_data_agent.model_provider_connection_versions revision
          where revision.app_id = managed_connection.app_id
            and revision.environment = managed_connection.environment
            and revision.provider_connection_id = managed_connection.provider_connection_id
            and revision.config_version = managed_connection.config_version;
          connection_available := managed_revision.provider_connection_id is not null
            and certification.document_json #>> '{connection,connection_hash}' =
              app_data_agent.u2_canonical_sha256(managed_revision.snapshot);
        end if;
      elsif certification.document_json #>> '{connection,kind}' = 'SYSTEM_DEPLOYMENT' then
        if app_data_agent.provider_json_object_has_exact_keys(
          certification.document_json -> 'connection',array[
            'kind','deployment_id','deployment_revision','deployment_hash'
          ]::text[])
          and certification.document_json #>> '{connection,deployment_id}' ~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then
          select mapping.* into deployment
          from platform.deployment_mappings mapping
          where mapping.app_id = authority.app_id
            and mapping.environment = authority.environment
            and mapping.deployment_id =
              (certification.document_json #>> '{connection,deployment_id}')::uuid
            and mapping.deployment_id = authority.deployment_id
            and mapping.is_active;
          expected_connection_hash := case when deployment.deployment_id is null then null else
            app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
              'deployment_id',deployment.deployment_id,'app_id',deployment.app_id,
              'environment',deployment.environment,
              'deployment_key_hash',deployment.deployment_key_hash)) end;
          connection_available := deployment.deployment_id is not null
            and certification.document_json #>> '{connection,deployment_revision}' = '1'
            and certification.document_json #>> '{connection,deployment_hash}' =
              expected_connection_hash;
        end if;
      end if;
      if not connection_available then
        readiness := 'CREDENTIAL_UNAVAILABLE';
        unavailable_reason := 'MODEL_CREDENTIAL_UNAVAILABLE';
      end if;
    end if;

    if readiness is null then
      profiles := profiles || pg_catalog.jsonb_build_array(common_document ||
        pg_catalog.jsonb_build_object(
          'adapter_version',certification.document_json -> 'adapter_version',
          'certification_receipt_ref',pg_catalog.jsonb_build_object(
            'artifact_id',certification.artifact_id,'artifact_type','ModelCertificationReceipt',
            'app_id',certification.app_id,'tenant_id',certification.tenant_id,
            'environment',certification.environment,'run_id',certification.run_id,
            'revision',certification.revision,'content_hash',certification.content_hash),
          'execution_profile_hash',certification.document_json -> 'execution_profile_hash',
          'recovery_capabilities',certification.document_json -> 'recovery_capabilities',
          'connection',certification.document_json -> 'connection',
          'effective_context_ceiling_tokens',
            certification.document_json #> '{execution_profile_snapshot,context_window,max_context_tokens}',
          'effective_output_ceiling_tokens',
            certification.document_json #> '{execution_profile_snapshot,context_window,max_output_tokens}',
          'readiness','AVAILABLE','selectable',true,'unavailable_reason',null));
    else
      profiles := profiles || pg_catalog.jsonb_build_array(common_document ||
        pg_catalog.jsonb_build_object(
          'readiness',readiness,'selectable',false,'unavailable_reason',unavailable_reason));
    end if;
  end loop;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-execution-profile-list@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id,
      'principal_id',authority.principal_id),
    'profiles',profiles);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = 'P0001', message = 'PROVIDER_EXECUTION_PROFILE_LIST_INVALID';
end
$function$;
