do $history_postconditions$
declare snapshot_row record; observed_count bigint; observed_digest text;
begin
  for snapshot_row in select * from semantic_successor_history_snapshot order by relation_name loop
    execute pg_catalog.format(
      'select pg_catalog.count(*),app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(source) order by to_jsonb(source)::text),'
      ||'''[]''::jsonb)) from %s source',pg_catalog.to_regclass(snapshot_row.relation_name))
      into strict observed_count,observed_digest;
    if observed_count<>snapshot_row.row_count or observed_digest<>snapshot_row.row_digest
    then raise exception using errcode='P0001',message='SEMANTIC_SUCCESSOR_HISTORY_DRIFT',
      detail=snapshot_row.relation_name; end if;
  end loop;
end
$history_postconditions$;

do $security_postconditions$
declare relation_name text; trigger_name text; definition text;
begin
  foreach relation_name in array array[
    'semantic_successor_release_stage','semantic_successor_projection_stage',
    'semantic_successor_stage_receipt']::text[] loop
    if not exists(select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='semantic' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity)
    then raise exception using errcode='P0001',message='SEMANTIC_SUCCESSOR_RLS_DRIFT'; end if;
  end loop;
  foreach trigger_name in array array[
    'semantic_source_release_history_immutable',
    'semantic_executable_projection_history_immutable',
    'semantic_relationship_projection_history_immutable',
    'semantic_runtime_restriction_projection_history_immutable',
    'semantic_graph_projection_history_immutable',
    'semantic_graph_node_projection_history_immutable',
    'semantic_graph_edge_projection_history_immutable',
    'semantic_source_release_graph_projection_history_immutable']::text[] loop
    if not exists(select 1 from pg_catalog.pg_trigger
      where tgname=trigger_name and not tgisinternal)
    then raise exception using errcode='P0001',message='SEMANTIC_FORMAL_HISTORY_TRIGGER_DRIFT',
      detail=trigger_name; end if;
  end loop;
  if pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_successor_release_stage','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_successor_projection_stage','INSERT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_successor_stage_receipt','UPDATE')
    or pg_catalog.has_function_privilege('public',
      'semantic.record_semantic_successor_stage(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.load_semantic_successor_stage(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.load_promoted_semantic_successor_release(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='SEMANTIC_SUCCESSOR_GRANT_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'semantic.lock_semantic_authority_fence')=0
    or pg_catalog.strpos(definition,'falcon24-authority-activation:')=0
    or pg_catalog.strpos(definition,'FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH')=0
    or pg_catalog.strpos(definition,'FALCON24_COMBINED_ACTIVATION_SMOKE_REQUIRED')=0
    or pg_catalog.strpos(definition,'FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH')=0
    or pg_catalog.strpos(definition,'FALCON24_E4_AUTHORITY_POLLUTED')=0
    or pg_catalog.strpos(definition,'combined-falcon24-semantic-activation-receipt@1.0.0')=0
  then raise exception using errcode='P0001',message='FALCON24_COMBINED_ACTIVATION_DEFINITION_DRIFT'; end if;
end
$security_postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010783_app_data_agent_semantic_successor_e4_activation',
  '__SEMANTIC_SUCCESSOR_E4_ACTIVATION_MIGRATION_CHECKSUM__');
