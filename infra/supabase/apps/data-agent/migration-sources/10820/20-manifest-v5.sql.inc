do $rewrite$
declare definition text;needle text;replacement text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.begin_falcon24_four_layer_gate(jsonb)'::regprocedure)
    into strict definition;
  needle:=$needle$
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@4.0.0'
        and turns_hash='sha256:1b197368096673c1015935308f2db4a4fcddb0f3cc04c73b627cd7ce4d97503f'))$needle$;
  replacement:=$replacement$
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@4.0.0'
        and turns_hash='sha256:1b197368096673c1015935308f2db4a4fcddb0f3cc04c73b627cd7ce4d97503f')
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@5.0.0'
        and turns_hash='sha256:040e238b038f8ec2d246f553ac26a1d7abc6067f152e4106f7aca93859c6d55c'))$replacement$;
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,needle,'')))
        / pg_catalog.length(needle)<>1
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@5.0.0')<>0
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_MANIFEST_V5_REWRITE_DRIFT'; end if;
  definition:=pg_catalog.replace(definition,needle,replacement);
  execute definition;
end
$rewrite$;

alter function app_data_agent.begin_falcon24_four_layer_gate(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.begin_falcon24_four_layer_gate(jsonb) from public;
grant execute on function app_data_agent.begin_falcon24_four_layer_gate(jsonb)
  to data_agent_backend;
