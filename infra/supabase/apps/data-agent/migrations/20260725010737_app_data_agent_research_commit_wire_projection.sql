-- research_commit_wire_projection_migration_checksum: sha256:a650ff037abbc5f3b36fff2343bc7e284e8427addebf1100f299891608b90a05
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_COMMIT_WIRE_PROJECTION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_COMMIT_WIRE_PROJECTION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010736_app_data_agent_research_initial_parent_repair')
  then raise exception using errcode='P0001',message='RESEARCH_COMMIT_WIRE_PROJECTION_BASELINE_10736_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

do $repair$
declare
  source_definition text;
  repaired_definition text;
  source_columns constant text := 'artifact_type, revision, content_hash, parent_ref, candidate_json';
  repaired_columns constant text := 'artifact_type, revision, content_hash, parent_ref, candidate_json,
    document_json, wire_protocol_version, budget_receipt_id, budget_receipt_hash';
  source_values constant text := 'candidate_envelope ->> ''content_hash'', expected_parent, candidate_json';
  repaired_values constant text := 'candidate_envelope ->> ''content_hash'', expected_parent, candidate_json,
    committed_document, candidate_payload ->> ''protocol_version'',
    nullif(candidate_payload ->> ''budget_receipt_id'', '''')::uuid,
    nullif(candidate_payload ->> ''budget_receipt_hash'', '''')';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_current_l2_artifact(jsonb)'::pg_catalog.regprocedure
  ) into strict source_definition;
  if pg_catalog.strpos(source_definition,source_columns)=0
    or pg_catalog.strpos(source_definition,source_values)=0
  then raise exception using errcode='P0001',message='RESEARCH_COMMIT_WIRE_L2_SOURCE_MISMATCH'; end if;
  repaired_definition:=pg_catalog.replace(source_definition,source_columns,repaired_columns);
  repaired_definition:=pg_catalog.replace(repaired_definition,source_values,repaired_values);
  execute repaired_definition;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_current_analysis_artifact(jsonb)'::pg_catalog.regprocedure
  ) into strict source_definition;
  if pg_catalog.strpos(source_definition,source_columns)=0
    or pg_catalog.strpos(source_definition,source_values)=0
  then raise exception using errcode='P0001',message='RESEARCH_COMMIT_WIRE_ANALYSIS_SOURCE_MISMATCH'; end if;
  repaired_definition:=pg_catalog.replace(source_definition,source_columns,repaired_columns);
  repaired_definition:=pg_catalog.replace(repaired_definition,source_values,repaired_values);
  execute repaired_definition;
end
$repair$;

do $postconditions$
declare
  l2_definition text;
  analysis_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_current_l2_artifact(jsonb)'::pg_catalog.regprocedure
  ) into strict l2_definition;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_current_analysis_artifact(jsonb)'::pg_catalog.regprocedure
  ) into strict analysis_definition;
  if pg_catalog.strpos(l2_definition,'document_json, wire_protocol_version, budget_receipt_id, budget_receipt_hash')=0
    or pg_catalog.strpos(analysis_definition,'document_json, wire_protocol_version, budget_receipt_id, budget_receipt_hash')=0
    or pg_catalog.strpos(l2_definition,'committed_document, candidate_payload ->> ''protocol_version''')=0
    or pg_catalog.strpos(analysis_definition,'committed_document, candidate_payload ->> ''protocol_version''')=0
  then raise exception using errcode='P0001',message='RESEARCH_COMMIT_WIRE_PROJECTION_NOT_INSTALLED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010737_app_data_agent_research_commit_wire_projection',
  'sha256:a650ff037abbc5f3b36fff2343bc7e284e8427addebf1100f299891608b90a05');
commit;
