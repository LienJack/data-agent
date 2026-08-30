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
