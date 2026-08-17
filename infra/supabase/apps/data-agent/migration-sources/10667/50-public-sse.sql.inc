-- Rendered from the reviewed runtime functions. Display events advance only the
-- durable projection cursor while retaining the active Run authority state.
create function app_data_agent.public_run_display_payload_is_valid(
  requested_event_type text,
  requested_payload jsonb
)
returns boolean language plpgsql immutable strict set search_path='' as $function$
declare key_count integer;
begin
  if pg_catalog.jsonb_typeof(requested_payload)<>'object' then return false; end if;
  select pg_catalog.count(*) into key_count from pg_catalog.jsonb_object_keys(requested_payload);
  case requested_event_type
    when 'run.progress' then
      return key_count=4 and requested_payload ?& array['phase','title','summary','status']
        and pg_catalog.jsonb_typeof(requested_payload->'phase')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'title')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'summary')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'status')='string'
        and pg_catalog.length(requested_payload->>'phase') between 1 and 128
        and pg_catalog.length(requested_payload->>'title') between 1 and 128
        and pg_catalog.length(requested_payload->>'summary') between 1 and 100000
        and requested_payload->>'status' in ('RUNNING','COMPLETED');
    when 'run.tool_started' then
      return key_count=5 and requested_payload ?& array[
          'call_id','tool_name','title','summary','input']
        and pg_catalog.jsonb_typeof(requested_payload->'call_id')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'tool_name')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'title')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'summary')='string'
        and pg_catalog.length(requested_payload->>'call_id') between 1 and 256
        and pg_catalog.length(requested_payload->>'tool_name') between 1 and 128
        and pg_catalog.length(requested_payload->>'title') between 1 and 128
        and pg_catalog.length(requested_payload->>'summary') between 1 and 100000
        and pg_catalog.jsonb_typeof(requested_payload->'input') in ('string','null')
        and pg_catalog.length(coalesce(requested_payload->>'input',''))<=100000;
    when 'run.tool_completed' then
      return key_count=5 and requested_payload ?& array[
          'call_id','tool_name','summary','output','duration_ms']
        and pg_catalog.jsonb_typeof(requested_payload->'call_id')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'tool_name')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'summary')='string'
        and pg_catalog.length(requested_payload->>'call_id') between 1 and 256
        and pg_catalog.length(requested_payload->>'tool_name') between 1 and 128
        and pg_catalog.length(requested_payload->>'summary') between 1 and 100000
        and pg_catalog.jsonb_typeof(requested_payload->'output') in ('string','null')
        and pg_catalog.length(coalesce(requested_payload->>'output',''))<=200000
        and pg_catalog.jsonb_typeof(requested_payload->'duration_ms')='number'
        and requested_payload->>'duration_ms' ~ '^(0|[1-9][0-9]{0,15})$'
        and (requested_payload->>'duration_ms')::numeric<=9007199254740991;
    when 'run.tool_failed' then
      return key_count=6 and requested_payload ?& array[
          'call_id','tool_name','summary','error_code','output','duration_ms']
        and pg_catalog.jsonb_typeof(requested_payload->'call_id')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'tool_name')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'summary')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'error_code')='string'
        and pg_catalog.length(requested_payload->>'call_id') between 1 and 256
        and pg_catalog.length(requested_payload->>'tool_name') between 1 and 128
        and pg_catalog.length(requested_payload->>'summary') between 1 and 100000
        and requested_payload->>'error_code' ~ '^[A-Z][A-Z0-9_]{0,127}$'
        and pg_catalog.jsonb_typeof(requested_payload->'output') in ('string','null')
        and pg_catalog.length(coalesce(requested_payload->>'output',''))<=200000
        and pg_catalog.jsonb_typeof(requested_payload->'duration_ms')='number'
        and requested_payload->>'duration_ms' ~ '^(0|[1-9][0-9]{0,15})$'
        and (requested_payload->>'duration_ms')::numeric<=9007199254740991;
    when 'run.answer_delta' then
      return key_count=1 and requested_payload ? 'delta'
        and pg_catalog.jsonb_typeof(requested_payload->'delta')='string'
        and pg_catalog.length(requested_payload->>'delta') between 1 and 100000;
    when 'run.reasoning_started' then
      return key_count=2 and requested_payload ?& array['block_id','title']
        and pg_catalog.jsonb_typeof(requested_payload->'block_id')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'title')='string'
        and pg_catalog.length(requested_payload->>'block_id') between 1 and 256
        and pg_catalog.length(requested_payload->>'title') between 1 and 128;
    when 'run.reasoning_delta' then
      return key_count=2 and requested_payload ?& array['block_id','delta']
        and pg_catalog.jsonb_typeof(requested_payload->'block_id')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'delta')='string'
        and pg_catalog.length(requested_payload->>'block_id') between 1 and 256
        and pg_catalog.length(requested_payload->>'delta') between 1 and 4096;
    when 'run.reasoning_completed' then
      return key_count=3 and requested_payload ?& array['block_id','summary','duration_ms']
        and pg_catalog.jsonb_typeof(requested_payload->'block_id')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'summary')='string'
        and pg_catalog.length(requested_payload->>'block_id') between 1 and 256
        and pg_catalog.length(requested_payload->>'summary') between 1 and 100000
        and pg_catalog.jsonb_typeof(requested_payload->'duration_ms')='number'
        and requested_payload->>'duration_ms' ~ '^(0|[1-9][0-9]{0,15})$'
        and (requested_payload->>'duration_ms')::numeric<=9007199254740991;
    else return false;
  end case;
exception when others then return false;
end
$function$;

__U20_PUBLIC_SSE_FUNCTION_OVERRIDES__
