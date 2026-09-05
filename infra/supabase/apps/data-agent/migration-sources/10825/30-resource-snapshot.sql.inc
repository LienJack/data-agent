-- v10 separates a resource snapshot from the strictly advancing turn ordinal.
-- v1-v9 keep their original strict resource-version progression on replay.
do $rewrite$
declare definition text;needle text;replacement text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb)'::regprocedure)
    into strict definition;
  needle:=$needle$      or previous_turn.conversation_resource_version>=
        (command->>'conversation_resource_version')::bigint$needle$;
  replacement:=$replacement$      or (case when attempt.manifest_document->>'schema_version'
          ='falcon24-four-layer-gate-manifest@10.0.0'
        then previous_turn.conversation_resource_version>
          (command->>'conversation_resource_version')::bigint
        else previous_turn.conversation_resource_version>=
          (command->>'conversation_resource_version')::bigint end)$replacement$;
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,needle,'')))
        / pg_catalog.length(needle)<>1
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@10.0.0')<>0
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_MANIFEST_V10_CLAIM_REWRITE_DRIFT'; end if;
  execute pg_catalog.replace(definition,needle,replacement);
end
$rewrite$;

alter function app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb) from public;
grant execute on function app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb)
  to data_agent_backend;
