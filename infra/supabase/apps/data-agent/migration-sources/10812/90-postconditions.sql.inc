do $postconditions$
declare before_row record;after_count bigint;after_digest text;rpc_owner text;rpc_secure boolean;
  rpc_source text;fence_source text;fence_owner text;
begin
  for before_row in select * from falcon24_10812_history_snapshot loop
    execute pg_catalog.format(
      'select count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)) from %I.%I r',
      pg_catalog.split_part(before_row.relation_name,'.',1),pg_catalog.split_part(before_row.relation_name,'.',2))
      into strict after_count,after_digest;
    if after_count<>before_row.row_count or after_digest<>before_row.row_digest
    then raise exception using errcode='P0001',message='FALCON24_PARTIAL_SUPERSESSION_HISTORY_DRIFT'; end if;
  end loop;
  select prosrc,pg_catalog.pg_get_userbyid(proowner),prosecdef into strict rpc_source,rpc_owner,rpc_secure
    from pg_catalog.pg_proc where oid='app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)'::regprocedure;
  select prosrc,pg_catalog.pg_get_userbyid(proowner) into strict fence_source,fence_owner
    from pg_catalog.pg_proc where oid='app_data_agent.falcon24_four_layer_attempt_state_fence()'::regprocedure;
  if rpc_owner<>'data_agent_u6_rpc_owner' or rpc_secure is distinct from true
    or fence_owner<>'data_agent_u6_data_owner'
    or pg_catalog.strpos(rpc_source,'passed_turn_count<>attempt.next_turn_ordinal')=0
    or pg_catalog.strpos(fence_source,'new.next_turn_ordinal=old.next_turn_ordinal')=0
    or pg_catalog.has_function_privilege('public','app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated','app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='FALCON24_PARTIAL_SUPERSESSION_POSTCONDITION_FAILED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010812_app_data_agent_falcon24_partial_ready_supersession',
  '__FALCON24_PARTIAL_READY_SUPERSESSION_MIGRATION_CHECKSUM__');
commit;
