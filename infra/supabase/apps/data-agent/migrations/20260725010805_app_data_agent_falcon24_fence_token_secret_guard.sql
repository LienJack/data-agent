-- falcon24_fence_token_secret_guard_migration_checksum: sha256:6c511eb4f8150e6bc2df2e16ce05e9c5facfa4344b20e1a3ef72f4155affa030
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare source_definition text;owner_name text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010804_app_data_agent_falcon24_failure_receipt_closure'
        and migration_checksum=
          'sha256:2c60adcf3bc2035d359580105316241d5c87b766a0419ffb820d6073c3cbcfa0')
    or pg_catalog.to_regprocedure(
      'app_data_agent.contains_potential_plaintext_secret(jsonb,text)') is null
  then raise exception using errcode='P0001',
    message='FALCON24_FENCE_TOKEN_SECRET_GUARD_BASELINE_DRIFT'; end if;
  select procedure_row.prosrc,owner_role.rolname
    into strict source_definition,owner_name
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
    where procedure_row.oid=
      'app_data_agent.contains_potential_plaintext_secret(jsonb,text)'::regprocedure;
  if pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_definition,'UTF8')),'hex')<>
      'ffeca6ae3e0368009e14a2fef3e197102b251800a8f4bebda8d0dbdc1f41b6cf'
    or owner_name<>'postgres'
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.contains_potential_plaintext_secret(jsonb,text)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.contains_potential_plaintext_secret(jsonb,text)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_FENCE_TOKEN_SECRET_GUARD_BASELINE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10805_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;

do $snapshot$
declare relation_name text;schema_name text;table_name text;
  before_count bigint;before_digest text;
begin
  foreach relation_name in array array[
    'app_data_agent.falcon24_current_authority_epoch',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'app_data_agent.falcon24_qualifications',
    'app_data_agent.falcon24_qualification_slots',
    'app_data_agent.falcon24_acceptance_campaigns',
    'app_data_agent.falcon24_acceptance_campaign_runs',
    'app_data_agent.falcon24_four_layer_gate_attempts',
    'app_data_agent.falcon24_four_layer_gate_turns',
    'app_data_agent.runs','app_data_agent.run_events','app_data_agent.run_attempts',
    'app_data_agent.artifacts'
  ]::text[] loop
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict before_count,before_digest;
    insert into falcon24_10805_history_snapshot
      values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
create or replace function app_data_agent.contains_potential_plaintext_secret(
  requested_value jsonb,
  requested_key text default ''
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  normalized_key text := pg_catalog.lower(coalesce(requested_key, ''));
  value_kind text;
  text_value text;
  child_key text;
  child_value jsonb;
  sensitive_key boolean;
  secret_reference_key boolean;
  secret_reference_collection_key boolean;
  non_credential_token_key boolean;
begin
  if requested_value is null then
    return false;
  end if;

  sensitive_key := normalized_key ~
    '(^|[_-])(secret|client[_-]?secret|consumer[_-]?secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|provider[_-]?token|password|passwd|credential|authorization|cookie|api[_-]?key|private[_-]?key|access[_-]?key[_-]?id|secret[_-]?access[_-]?key)($|[_-])';
  secret_reference_key := normalized_key ~
    '(^|[_-])(secret|credential)[_-]?refs?$';
  secret_reference_collection_key := normalized_key ~
    '(^|[_-])(secret|credential)[_-]?refs$';
  non_credential_token_key := normalized_key ~
    '^(snapshot|fence|fencing)_token$';
  value_kind := pg_catalog.jsonb_typeof(requested_value);
  if non_credential_token_key then
    if value_kind = 'null' then
      return false;
    end if;
    if value_kind <> 'string' then
      return true;
    end if;
    text_value := requested_value #>> '{}';
    return text_value ~*
      '(^bearer[[:space:]]+[^[:space:]]+|^sk-[A-Za-z0-9_-]{12,}|^gh[pousr]_[A-Za-z0-9_]{20,}|^glpat-[A-Za-z0-9_-]{20,}|^xox[baprs]-[A-Za-z0-9-]{10,}|^(AKIA|ASIA)[A-Z0-9]{16}|^AIza[A-Za-z0-9_-]{20,}|^eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}|^-----BEGIN [A-Z ]*PRIVATE KEY-----|^([a-z][a-z0-9+.-]*:)+//[^/[:space:]:@]*:[^@[:space:]]+@|(password|token|secret|api[_-]?key|authorization)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)';
  end if;
  if sensitive_key and not secret_reference_key then
    return true;
  end if;

  if secret_reference_key
    and value_kind <> 'string'
    and not (secret_reference_collection_key and value_kind = 'array')
  then
    return true;
  end if;
  if value_kind = 'string' then
    text_value := requested_value #>> '{}';
    if secret_reference_key then
      return text_value !~*
        '^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    end if;
    return text_value ~*
      '(^bearer[[:space:]]+[^[:space:]]+|^sk-[A-Za-z0-9_-]{12,}|^gh[pousr]_[A-Za-z0-9_]{20,}|^glpat-[A-Za-z0-9_-]{20,}|^xox[baprs]-[A-Za-z0-9-]{10,}|^(AKIA|ASIA)[A-Z0-9]{16}|^AIza[A-Za-z0-9_-]{20,}|^eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}|^-----BEGIN [A-Z ]*PRIVATE KEY-----|^([a-z][a-z0-9+.-]*:)+//[^/[:space:]:@]*:[^@[:space:]]+@|(password|token|secret|api[_-]?key|authorization)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)';
  end if;
  if value_kind = 'array' then
    if secret_reference_collection_key
      and pg_catalog.jsonb_array_length(requested_value) = 0
    then
      return true;
    end if;
    for child_value in
      select element.value
      from pg_catalog.jsonb_array_elements(requested_value) as element(value)
    loop
      if app_data_agent.contains_potential_plaintext_secret(
        child_value,
        requested_key
      ) then
        return true;
      end if;
    end loop;
    return false;
  end if;
  if value_kind = 'object' then
    for child_key, child_value in
      select entry.key, entry.value
      from pg_catalog.jsonb_each(requested_value) as entry(key, value)
    loop
      if app_data_agent.contains_potential_plaintext_secret(
        child_value,
        child_key
      ) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end
$function$;
do $postconditions$
declare before_row record;relation_name text;schema_name text;table_name text;
  after_count bigint;after_digest text;source_definition text;owner_name text;
begin
  select procedure_row.prosrc,owner_role.rolname
    into strict source_definition,owner_name
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
    where procedure_row.oid=
      'app_data_agent.contains_potential_plaintext_secret(jsonb,text)'::regprocedure;
  if pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_definition,'UTF8')),'hex')<>
      '19e6a612cf1d52995532cae5cab67f5db529f293b993fce3cd18e6a11fdc6989'
    or owner_name<>'postgres'
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.contains_potential_plaintext_secret(jsonb,text)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.contains_potential_plaintext_secret(jsonb,text)','EXECUTE')
    or app_data_agent.contains_potential_plaintext_secret(
      pg_catalog.to_jsonb('00000000-0000-4000-8000-000000000001:1'::text),'fence_token')
    or app_data_agent.contains_potential_plaintext_secret(
      pg_catalog.to_jsonb('snapshot-cursor-1'::text),'snapshot_token')
    or app_data_agent.contains_potential_plaintext_secret(
      pg_catalog.to_jsonb('worker-fence-1'::text),'fencing_token')
    or app_data_agent.contains_potential_plaintext_secret(
      pg_catalog.jsonb_build_object('sandbox_receipt_payload',
        pg_catalog.jsonb_build_object('fence_token',
          '00000000-0000-4000-8000-000000000001:1')))
    or not app_data_agent.contains_potential_plaintext_secret(
      pg_catalog.to_jsonb('ordinary-value'::text),'token')
    or not app_data_agent.contains_potential_plaintext_secret(
      pg_catalog.to_jsonb('Bearer guarded-secret-value'::text),'fence_token')
    or not app_data_agent.contains_potential_plaintext_secret(
      pg_catalog.to_jsonb('sk-guardedSecretValue1234567890'::text),'fence_token')
    or not app_data_agent.contains_potential_plaintext_secret(
      pg_catalog.jsonb_build_object('unexpected','shape'),'fence_token')
  then raise exception using errcode='P0001',
    message='FALCON24_FENCE_TOKEN_SECRET_GUARD_POSTCONDITION_FAILED'; end if;
  for before_row in select * from falcon24_10805_history_snapshot order by relation_name loop
    relation_name:=before_row.relation_name;
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict after_count,after_digest;
    if after_count<>before_row.row_count or after_digest<>before_row.row_digest
    then raise exception using errcode='P0001',
      message='FALCON24_FENCE_TOKEN_SECRET_GUARD_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010805_app_data_agent_falcon24_fence_token_secret_guard',
  'sha256:6c511eb4f8150e6bc2df2e16ce05e9c5facfa4344b20e1a3ef72f4155affa030');

commit;
