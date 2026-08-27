do $patch_root_visible_message_refs$
declare definition text;repaired text;
  predecessor text;successor text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure)
    into strict definition;
  predecessor:=
    $$'visible_message_refs',pg_catalog.jsonb_build_array(requested_command->>'event_id')$$;
  successor:=
    $$'visible_message_refs',
        coalesce((select pg_catalog.jsonb_agg(prior.message_id order by
            prior.created_at,prior.message_id)
          from (select message.message_id,message.created_at
            from app_data_agent.qa_messages message
            where message.app_id=authority.app_id
              and message.tenant_id=authority.tenant_id
              and message.environment=authority.environment
              and message.conversation_id=requested_conversation_id
              and message.owner_principal_id=authority.principal_id
            order by message.created_at desc,message.message_id desc
            limit 63) prior),'[]'::jsonb)
          ||pg_catalog.jsonb_build_array(requested_command->>'event_id')$$;
  repaired:=pg_catalog.replace(definition,predecessor,successor);
  if repaired=definition or pg_catalog.strpos(repaired,successor)=0
  then raise exception using errcode='P0001',
    message='CONVERSATIONAL_ROOT_VISIBLE_REFS_REWRITE_MISSED'; end if;
  execute repaired;
end
$patch_root_visible_message_refs$;
