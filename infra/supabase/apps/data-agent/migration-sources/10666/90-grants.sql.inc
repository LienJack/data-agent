alter table app_data_agent.run_interruptions owner to data_agent_u8_recovery_owner;
alter table app_data_agent.run_interruption_replies owner to data_agent_u8_recovery_owner;
alter table app_data_agent.session_branches owner to data_agent_u8_recovery_owner;
alter table app_data_agent.session_recovery_operation_receipts owner to data_agent_u8_recovery_owner;
alter function app_data_agent.reject_session_recovery_immutable_mutation() owner to data_agent_u8_recovery_owner;
alter function app_data_agent.guard_run_interruption_transition() owner to data_agent_u8_recovery_owner;
alter function app_data_agent.u8_replayed_receipt(jsonb) owner to data_agent_u8_recovery_owner;
alter function app_data_agent.open_run_interruption(jsonb) owner to data_agent_u8_recovery_owner;
alter function app_data_agent.reply_run_interruption(jsonb) owner to data_agent_u8_recovery_owner;
alter function app_data_agent.create_session_branch(jsonb) owner to data_agent_u8_recovery_owner;
alter function app_data_agent.load_run_interruption(uuid) owner to data_agent_u8_recovery_owner;
alter function app_data_agent.list_session_branches(uuid) owner to data_agent_u8_recovery_owner;

grant usage on schema app_data_agent,platform to data_agent_u8_recovery_owner;
grant select on app_data_agent.runs,app_data_agent.run_projections,app_data_agent.run_checkpoints,
  app_data_agent.effective_config_context_receipts,app_data_agent.effective_run_config_receipts,
  app_data_agent.workspace_run_bindings,app_data_agent.qa_conversations,app_data_agent.qa_messages
  to data_agent_u8_recovery_owner;
grant update on app_data_agent.runs,app_data_agent.run_projections to data_agent_u8_recovery_owner;
grant execute on function platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.runtime_canonical_sha256(jsonb),app_data_agent.runtime_iso_timestamp(timestamptz),
  app_data_agent.resolved_context_exact_keys(jsonb,text[]),
  app_data_agent.resolved_context_uuid_v8_from_hash(text),
  app_data_agent.reduce_run_projection_document(jsonb,jsonb),
  app_data_agent.request_run_control(jsonb,jsonb,text,text,jsonb,text)
  to data_agent_u8_recovery_owner;

revoke all on app_data_agent.run_interruptions,app_data_agent.run_interruption_replies,
  app_data_agent.session_branches,app_data_agent.session_recovery_operation_receipts
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.u8_replayed_receipt(jsonb),
  app_data_agent.open_run_interruption(jsonb),app_data_agent.reply_run_interruption(jsonb),
  app_data_agent.create_session_branch(jsonb),app_data_agent.load_run_interruption(uuid),
  app_data_agent.list_session_branches(uuid)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.open_run_interruption(jsonb),
  app_data_agent.reply_run_interruption(jsonb),app_data_agent.create_session_branch(jsonb),
  app_data_agent.load_run_interruption(uuid),app_data_agent.list_session_branches(uuid)
  to data_agent_backend;

do $postconditions$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u8_recovery_owner'
    and not rolcanlogin and not rolsuper and not rolinherit and not rolbypassrls)
  then raise exception using errcode='P0001',message='U8_RECOVERY_OWNER_FLAGS_UNSAFE'; end if;
  if exists(select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
    on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname in ('run_interruptions','run_interruption_replies','session_branches',
        'session_recovery_operation_receipts')
      and (not relation.relrowsecurity or not relation.relforcerowsecurity
        or relation.relowner<>(select oid from pg_catalog.pg_roles where rolname='data_agent_u8_recovery_owner')))
  then raise exception using errcode='P0001',message='U8_RECOVERY_RLS_OR_OWNER_UNSAFE'; end if;
end
$postconditions$;
