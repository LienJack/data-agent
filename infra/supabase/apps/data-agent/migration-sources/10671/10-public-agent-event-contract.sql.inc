create function app_data_agent.public_run_v2_payload_is_valid(
  requested_event_type text,
  requested_payload jsonb,
  requested_scope jsonb,
  requested_run_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  key_count integer;
  reference jsonb;
  started_payload jsonb;
begin
  if pg_catalog.jsonb_typeof(requested_payload)<>'object' then return false; end if;
  select pg_catalog.count(*) into key_count from pg_catalog.jsonb_object_keys(requested_payload);

  if requested_event_type='run.agent_status' then
    return key_count=8
      and requested_payload ?& array['profile_id','task_id','status','phase','title','summary','duration_ms','error_code']
      and requested_payload->>'profile_id' in ('governed-text2sql-agent','report-writing-agent','semantic-management-agent')
      and pg_catalog.jsonb_typeof(requested_payload->'task_id') in ('string','null')
      and (requested_payload->>'task_id' is null or requested_payload->>'task_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      and requested_payload->>'status' in ('PENDING','RUNNING','COMPLETED','FAILED','INTERRUPTED','SKIPPED','BLOCKED')
      and (requested_payload->>'task_id' is not null or requested_payload->>'status'='PENDING')
      and pg_catalog.jsonb_typeof(requested_payload->'phase')='string'
      and pg_catalog.length(requested_payload->>'phase') between 1 and 128
      and pg_catalog.jsonb_typeof(requested_payload->'title')='string'
      and pg_catalog.length(requested_payload->>'title') between 1 and 128
      and pg_catalog.jsonb_typeof(requested_payload->'summary')='string'
      and pg_catalog.length(requested_payload->>'summary') between 1 and 100000
      and pg_catalog.jsonb_typeof(requested_payload->'duration_ms') in ('number','null')
      and (requested_payload->>'duration_ms' is null or (
        requested_payload->>'duration_ms' ~ '^(0|[1-9][0-9]{0,15})$'
        and (requested_payload->>'duration_ms')::numeric<=9007199254740991))
      and pg_catalog.jsonb_typeof(requested_payload->'error_code') in ('string','null')
      and (requested_payload->>'error_code' is null or requested_payload->>'error_code' ~ '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$');
  end if;

  if requested_event_type not in ('run.tool_started','run.tool_completed','run.tool_failed') then return false; end if;
  if key_count <> (case requested_event_type when 'run.tool_failed' then 9 else 8 end) then return false; end if;
  if not requested_payload ?& array['call_id','tool_name','summary','profile_id','task_id','artifact_refs'] then return false; end if;
  if requested_event_type='run.tool_started' and not requested_payload ?& array['title','input'] then return false; end if;
  if requested_event_type='run.tool_completed' and not requested_payload ?& array['output','duration_ms'] then return false; end if;
  if requested_event_type='run.tool_failed' and not requested_payload ?& array['error_code','output','duration_ms'] then return false; end if;
  if pg_catalog.jsonb_typeof(requested_payload->'call_id')<>'string'
    or pg_catalog.length(requested_payload->>'call_id') not between 1 and 256
    or pg_catalog.jsonb_typeof(requested_payload->'tool_name')<>'string'
    or pg_catalog.length(requested_payload->>'tool_name') not between 1 and 128
    or pg_catalog.jsonb_typeof(requested_payload->'summary')<>'string'
    or pg_catalog.length(requested_payload->>'summary') not between 1 and 100000
    or pg_catalog.jsonb_typeof(requested_payload->'profile_id') not in ('string','null')
    or pg_catalog.jsonb_typeof(requested_payload->'task_id') not in ('string','null')
    or ((requested_payload->>'profile_id' is null) <> (requested_payload->>'task_id' is null))
    or (requested_payload->>'profile_id' is not null and requested_payload->>'profile_id' not in ('governed-text2sql-agent','report-writing-agent','semantic-management-agent'))
    or (requested_payload->>'task_id' is not null and requested_payload->>'task_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    or pg_catalog.jsonb_typeof(requested_payload->'artifact_refs')<>'array'
    or pg_catalog.jsonb_array_length(requested_payload->'artifact_refs')>32
  then return false; end if;
  if exists(select 1 from app_data_agent.commands command
      where command.app_id=(requested_scope->>'app_id')::uuid
        and command.tenant_id=(requested_scope->>'tenant_id')::uuid
        and command.environment=requested_scope->>'environment'
        and command.run_id=requested_run_id
        and command.payload_json->>'kind'='START_DATA_AGENT_TEAM')
    and requested_payload->>'profile_id' is null
  then return false; end if;
  if exists(select 1 from app_data_agent.commands command
      where command.app_id=(requested_scope->>'app_id')::uuid
        and command.tenant_id=(requested_scope->>'tenant_id')::uuid
        and command.environment=requested_scope->>'environment'
        and command.run_id=requested_run_id
        and command.payload_json->>'kind'<>'START_DATA_AGENT_TEAM')
    and requested_payload->>'profile_id' is not null
  then return false; end if;
  if requested_event_type='run.tool_started' and (
    pg_catalog.jsonb_array_length(requested_payload->'artifact_refs')<>0
    or pg_catalog.jsonb_typeof(requested_payload->'title')<>'string'
    or pg_catalog.length(requested_payload->>'title') not between 1 and 128
    or pg_catalog.jsonb_typeof(requested_payload->'input') not in ('string','null')
    or pg_catalog.length(coalesce(requested_payload->>'input',''))>100000
  ) then return false; end if;
  if requested_event_type in ('run.tool_completed','run.tool_failed') and (
    pg_catalog.jsonb_typeof(requested_payload->'output') not in ('string','null')
    or pg_catalog.length(coalesce(requested_payload->>'output',''))>200000
    or pg_catalog.jsonb_typeof(requested_payload->'duration_ms')<>'number'
    or requested_payload->>'duration_ms' !~ '^(0|[1-9][0-9]{0,15})$'
    or (requested_payload->>'duration_ms')::numeric>9007199254740991
  ) then return false; end if;
  if requested_event_type='run.tool_failed' and (
    pg_catalog.jsonb_typeof(requested_payload->'error_code')<>'string'
    or requested_payload->>'error_code' !~ '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$'
  ) then return false; end if;

  for reference in select value from pg_catalog.jsonb_array_elements(requested_payload->'artifact_refs') loop
    select pg_catalog.count(*) into key_count from pg_catalog.jsonb_object_keys(reference);
    if key_count<>8 or not reference ?& array['artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash']
      or reference->>'app_id' is distinct from requested_scope->>'app_id'
      or reference->>'tenant_id' is distinct from requested_scope->>'tenant_id'
      or reference->>'environment' is distinct from requested_scope->>'environment'
      or reference->>'run_id' is distinct from requested_run_id::text
      or reference->>'artifact_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or reference->>'artifact_type' !~ '^[A-Za-z][A-Za-z0-9_.-]{1,126}$'
      or reference->>'revision' !~ '^[1-9][0-9]{0,9}$'
      or reference->>'content_hash' !~ '^sha256:[0-9a-f]{64}$'
      or not exists(select 1 from app_data_agent.artifacts artifact
        where artifact.app_id=(reference->>'app_id')::uuid and artifact.tenant_id=(reference->>'tenant_id')::uuid
          and artifact.environment=reference->>'environment' and artifact.run_id=(reference->>'run_id')::uuid
          and artifact.artifact_id=(reference->>'artifact_id')::uuid and artifact.artifact_type=reference->>'artifact_type'
          and artifact.revision=(reference->>'revision')::integer and artifact.content_hash=reference->>'content_hash' and artifact.is_active)
    then return false; end if;
  end loop;

  if requested_event_type='run.tool_started' then
    return not exists(select 1 from app_data_agent.run_events event
      where event.app_id=(requested_scope->>'app_id')::uuid and event.tenant_id=(requested_scope->>'tenant_id')::uuid
        and event.environment=requested_scope->>'environment' and event.run_id=requested_run_id
        and event.event_type in ('run.tool_started','run.tool_completed','run.tool_failed')
        and event.payload_json->>'call_id'=requested_payload->>'call_id');
  end if;
  select event.payload_json into started_payload from app_data_agent.run_events event
    where event.app_id=(requested_scope->>'app_id')::uuid and event.tenant_id=(requested_scope->>'tenant_id')::uuid
      and event.environment=requested_scope->>'environment' and event.run_id=requested_run_id
      and event.event_type='run.tool_started' and event.event_document->>'schema_version'='run-runtime-event@2.0.0'
      and event.payload_json->>'call_id'=requested_payload->>'call_id'
    order by event.sequence desc limit 1;
  return started_payload is not null
    and started_payload->>'tool_name' is not distinct from requested_payload->>'tool_name'
    and started_payload->>'profile_id' is not distinct from requested_payload->>'profile_id'
    and started_payload->>'task_id' is not distinct from requested_payload->>'task_id'
    and not exists(select 1 from app_data_agent.run_events event
      where event.app_id=(requested_scope->>'app_id')::uuid and event.tenant_id=(requested_scope->>'tenant_id')::uuid
        and event.environment=requested_scope->>'environment' and event.run_id=requested_run_id
        and event.event_type in ('run.tool_completed','run.tool_failed')
        and event.payload_json->>'call_id'=requested_payload->>'call_id');
exception when others then return false;
end
$function$;

__PUBLIC_AGENT_EVENT_FUNCTION_OVERRIDES__

create function app_data_agent.validate_public_run_v2_event_insert()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  if new.event_document->>'schema_version'='run-runtime-event@2.0.0'
    and not app_data_agent.public_run_v2_payload_is_valid(
      new.event_type,new.payload_json,new.event_document->'scope',new.run_id)
  then raise exception using errcode='22023',message='DA_RUN_PUBLIC_V2_EVENT_INVALID'; end if;
  return new;
end
$function$;

drop trigger if exists run_event_v2_contract on app_data_agent.run_events;
create trigger run_event_v2_contract before insert on app_data_agent.run_events
for each row execute function app_data_agent.validate_public_run_v2_event_insert();

revoke all on function app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.validate_public_run_v2_event_insert()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
