do $rewrite$
declare definition text;needle text;replacement text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.begin_falcon24_four_layer_gate(jsonb)'::regprocedure)
    into strict definition;
  needle:=$needle$
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@9.0.0'
        and turns_hash='sha256:04ee93aa5fc9eb0e21ae58c5d7b9503ffa8705866b1af11461e7881c444f7de9'))$needle$;
  replacement:=$replacement$
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@9.0.0'
        and turns_hash='sha256:04ee93aa5fc9eb0e21ae58c5d7b9503ffa8705866b1af11461e7881c444f7de9')
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@10.0.0'
        and turns_hash='sha256:04ee93aa5fc9eb0e21ae58c5d7b9503ffa8705866b1af11461e7881c444f7de9'))$replacement$;
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,needle,'')))
        / pg_catalog.length(needle)<>1
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@10.0.0')<>0
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_MANIFEST_V10_REWRITE_DRIFT'; end if;
  definition:=pg_catalog.replace(definition,needle,replacement);
  execute definition;
end
$rewrite$;

alter function app_data_agent.begin_falcon24_four_layer_gate(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.begin_falcon24_four_layer_gate(jsonb) from public;
grant execute on function app_data_agent.begin_falcon24_four_layer_gate(jsonb)
  to data_agent_backend;
