alter function app_data_agent.list_provider_execution_profiles()
  rename to list_provider_execution_profiles_pre_e8;

create function app_data_agent.list_provider_execution_profiles()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  document jsonb;profile jsonb;profiles jsonb:='[]'::jsonb;matches_stage boolean;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE')
  then raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment;
  if current_epoch.authority_epoch is null
    or pg_catalog.substr(current_epoch.authority_epoch,2)::numeric<8
  then return app_data_agent.list_provider_execution_profiles_pre_e8(); end if;
  document:=app_data_agent.list_provider_execution_profiles_pre_e7();
  select * into stage from app_data_agent.falcon24_llm_execution_certification_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.target_authority_epoch=current_epoch.authority_epoch
      and current_epoch.activation_attempt_id=row.activation_attempt_id
      and row.status='PROMOTED';
  for profile in select item from pg_catalog.jsonb_array_elements(document->'profiles') item loop
    matches_stage:=stage.stage_id is not null
      and profile->>'model_profile_id'=stage.model_profile_id::text
      and profile->>'model_config_version'=stage.model_config_version::text
      and profile->>'execution_profile_hash'=stage.execution_profile_hash
      and profile#>>'{certification_receipt_ref,run_id}'=stage.certification_run_id::text
      and profile#>>'{certification_receipt_ref,artifact_id}'=stage.certification_artifact_id::text
      and profile#>>'{certification_receipt_ref,revision}'=stage.certification_revision::text
      and profile#>>'{certification_receipt_ref,content_hash}'=stage.certification_content_hash;
    if profile->>'readiness'='AVAILABLE' and not matches_stage then
      profile:=(profile-array['adapter_version','certification_receipt_ref',
        'execution_profile_hash','recovery_capabilities','connection',
        'effective_context_ceiling_tokens','effective_output_ceiling_tokens'])
        ||pg_catalog.jsonb_build_object(
          'readiness','STALE','selectable',false,'unavailable_reason','MODEL_PROFILE_STALE');
    end if;
    profiles:=profiles||pg_catalog.jsonb_build_array(profile);
  end loop;
  return pg_catalog.jsonb_set(document,'{profiles}',profiles,false);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='P0001',message='PROVIDER_EXECUTION_PROFILE_LIST_INVALID';
end
$function$;
