do $rewrite$
declare definition text;needle text;replacement text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.begin_falcon24_four_layer_gate(jsonb)'::regprocedure)
    into strict definition;
  needle:=$needle$
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@2.0.0'
        and turns_hash='sha256:4ecf4742d2f8a201b3abe9609177441a0672a629becb4f58a23c18b7c7251142'))$needle$;
  replacement:=$replacement$
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@2.0.0'
        and turns_hash='sha256:4ecf4742d2f8a201b3abe9609177441a0672a629becb4f58a23c18b7c7251142')
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@3.0.0'
        and turns_hash='sha256:bc9fdac88acf23889beabeb2ae2c6f49d3df93d72c02d87ab1fde023e434564a'))$replacement$;
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,needle,'')))
        / pg_catalog.length(needle)<>1
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@3.0.0')<>0
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_MANIFEST_V3_REWRITE_DRIFT'; end if;
  definition:=pg_catalog.replace(definition,needle,replacement);
  execute definition;
end
$rewrite$;

alter function app_data_agent.begin_falcon24_four_layer_gate(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.begin_falcon24_four_layer_gate(jsonb) from public;
grant execute on function app_data_agent.begin_falcon24_four_layer_gate(jsonb)
  to data_agent_backend;
