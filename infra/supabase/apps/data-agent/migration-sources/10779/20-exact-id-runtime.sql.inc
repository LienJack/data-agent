do $rewrite_campaign_identity_validators$
declare function_row record;function_definition text;rewritten_definition text;
  rewritten_count integer:=0;
begin
  for function_row in
    select procedure.oid
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent'
      and procedure.prosrc like '%^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$%'
  loop
    function_definition:=pg_catalog.pg_get_functiondef(function_row.oid);
    rewritten_definition:=pg_catalog.replace(function_definition,
      $$command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'$$,
      $$command->>'campaign_id' is distinct from 'E1-C1'$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$submit_fence_command->>'campaign_id'!~
      '^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'$$,
      $$submit_fence_command->>'campaign_id' is distinct from 'E1-C1'$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$manifest->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'$$,
      $$manifest->>'campaign_id' is distinct from 'E1-C1'$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$or pg_catalog.length(command->>'campaign_id') not between 8 and 80$$,
      $$$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$or pg_catalog.length(submit_fence_command->>'campaign_id') not between 8 and 80$$,
      $$$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$or pg_catalog.length(manifest->>'campaign_id') not between 8 and 80$$,
      $$$$);
    if rewritten_definition=function_definition then
      raise exception using errcode='P0001',message='FALCON24_E1_CAMPAIGN_VALIDATOR_REWRITE_MISSED';
    end if;
    execute rewritten_definition;
    rewritten_count:=rewritten_count+1;
  end loop;
  if rewritten_count<>14 then
    raise exception using errcode='P0001',message='FALCON24_E1_CAMPAIGN_VALIDATOR_INVENTORY_DRIFT',
      detail=pg_catalog.jsonb_build_object('observed',rewritten_count)::text;
  end if;
end
$rewrite_campaign_identity_validators$;
