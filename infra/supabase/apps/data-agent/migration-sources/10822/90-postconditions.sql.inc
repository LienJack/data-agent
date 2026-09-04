do $postconditions$
declare before_row record;after_count bigint;after_digest text;definition text;
begin
  for before_row in select * from falcon24_10822_history_snapshot order by relation_name loop
    execute pg_catalog.format(
      'select count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)) from %s r',
      before_row.relation_name) into strict after_count,after_digest;
    if after_count is distinct from before_row.row_count or after_digest is distinct from before_row.row_digest
    then raise exception using errcode='P0001',
      message='FALCON24_FOUR_LAYER_MANIFEST_V7_HISTORY_DRIFT'; end if;
  end loop;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.begin_falcon24_four_layer_gate(jsonb)'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@1.0.0')=0
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@2.0.0')=0
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@3.0.0')=0
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@4.0.0')=0
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@5.0.0')=0
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@6.0.0')=0
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@7.0.0')=0
    or pg_catalog.strpos(definition,'sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9')=0
    or pg_catalog.strpos(definition,'sha256:4ecf4742d2f8a201b3abe9609177441a0672a629becb4f58a23c18b7c7251142')=0
    or pg_catalog.strpos(definition,'sha256:bc9fdac88acf23889beabeb2ae2c6f49d3df93d72c02d87ab1fde023e434564a')=0
    or pg_catalog.strpos(definition,'sha256:1b197368096673c1015935308f2db4a4fcddb0f3cc04c73b627cd7ce4d97503f')=0
    or pg_catalog.strpos(definition,'sha256:040e238b038f8ec2d246f553ac26a1d7abc6067f152e4106f7aca93859c6d55c')=0
    or pg_catalog.strpos(definition,'sha256:959a850d482cd49fb8840da0a2f7c0cdc1a788bcbe1f00430bbd591afd07b22a')=0
    or pg_catalog.strpos(definition,'sha256:df80081985d2a65f2ea161bb079a8b2a1dfa2930a90090493f3be6f640032795')=0
    or not exists(select 1 from pg_catalog.pg_proc
      where oid='app_data_agent.begin_falcon24_four_layer_gate(jsonb)'::regprocedure
        and pg_catalog.pg_get_userbyid(proowner)='data_agent_u6_rpc_owner' and prosecdef
        and proacl is not distinct from (select proacl from falcon24_10822_function_acl_snapshot))
    or pg_catalog.has_function_privilege(
      'public','app_data_agent.begin_falcon24_four_layer_gate(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.begin_falcon24_four_layer_gate(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_MANIFEST_V7_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
