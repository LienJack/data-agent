-- Fresh-prefix assertions only; no ModelCertificationReceipt or failed Run is fabricated.
begin;
do $assertions$
declare candidate jsonb;version_number integer;
begin
  if not exists(select 1 from platform.migration_ledger where
      migration_version='20260725010814_app_data_agent_falcon24_four_layer_recovery')
  then raise exception 'FALCON24_RECOVERY_ASSERTION_PREFIX_MISSING'; end if;
  foreach candidate in array array[
    null::jsonb,'null'::jsonb,'{}'::jsonb,'[]'::jsonb,
    '{"schema_version":null}'::jsonb,
    '{"schema_version":"falcon24-activation-request@8.0.0"}'::jsonb
  ] loop
    begin
      perform app_data_agent.activate_falcon24_authority(candidate);
      raise exception 'FALCON24_RECOVERY_INVALID_INPUT_ACCEPTED';
    exception when sqlstate '22023' then
      if sqlerrm<>'FALCON24_FOUR_LAYER_RECOVERY_ACTIVATION_INVALID' then raise; end if;
    end;
  end loop;
  for version_number in 2..7 loop
    begin
      perform app_data_agent.activate_falcon24_authority(pg_catalog.jsonb_build_object(
        'schema_version','falcon24-activation-request@'||version_number::text||'.0.0',
        'authority_epoch','E12'));
      raise exception 'FALCON24_RECOVERY_LEGACY_BYPASS_ACCEPTED';
    exception when sqlstate '22023' then
      if sqlerrm<>'FALCON24_FOUR_LAYER_RECOVERY_PROTOCOL_REQUIRED' then raise; end if;
    end;
  end loop;
  if pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.activate_falcon24_authority_pre_e12(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',
      'app_data_agent.activate_falcon24_authority(jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_retained_recovery_activation_receipts','INSERT,UPDATE,DELETE')
    or pg_catalog.has_table_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.falcon24_retained_recovery_activation_receipts','UPDATE,DELETE,TRUNCATE')
  then raise exception 'FALCON24_RECOVERY_ASSERTION_PERMISSION_DRIFT'; end if;
end
$assertions$;
rollback;
