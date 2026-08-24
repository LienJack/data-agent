create or replace function app_data_agent.assert_analysis_lifecycle_fence(
  envelope_json jsonb,
  command_json jsonb
)
returns void language plpgsql volatile security definer set search_path=''
as $function$
declare scope_json jsonb; target record; capability_envelope jsonb;
begin
  scope_json:=command_json->'scope';
  capability_envelope:=pg_catalog.jsonb_build_object(
    'protocol_version',envelope_json->>'protocol_version',
    'authority_capability_id',envelope_json->>'authority_capability_id',
    'command',command_json
  );
  perform app_data_agent.lock_u6_authority_capability(
    capability_envelope,'RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE',null,null,true
  );
  select attempts.attempt_id into target
  from app_data_agent.runs as runs
  join app_data_agent.run_attempts as attempts
    on attempts.app_id=runs.app_id and attempts.tenant_id=runs.tenant_id
    and attempts.environment=runs.environment and attempts.run_id=runs.run_id
  join app_data_agent.outbox as outbox
    on outbox.app_id=attempts.app_id and outbox.tenant_id=attempts.tenant_id
    and outbox.environment=attempts.environment and outbox.outbox_id=attempts.outbox_id
  where runs.app_id=(scope_json->>'app_id')::uuid
    and runs.tenant_id=(scope_json->>'tenant_id')::uuid
    and runs.environment=scope_json->>'environment'
    and runs.run_id=(command_json->>'run_id')::uuid
    and runs.principal_id=(command_json->>'principal_id')::uuid
    and attempts.attempt_id=(command_json->>'attempt_id')::uuid
    and attempts.status='ACTIVE'
    and attempts.worker_fence=(command_json->>'worker_fence')::bigint
    and attempts.lease_expires_at>pg_catalog.clock_timestamp()
    and outbox.active_attempt_id=attempts.attempt_id
    and outbox.run_fence=attempts.worker_fence
  for update of runs,attempts,outbox nowait;
  if target.attempt_id is null then
    raise exception using errcode='42501',message='DA_U6_CAPABILITY_REQUIRED';
  end if;
end
$function$;

alter function app_data_agent.assert_analysis_lifecycle_fence(jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.assert_analysis_lifecycle_fence(jsonb,jsonb) from public;
