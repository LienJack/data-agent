create function app_data_agent.resolve_run_delivery_attempt_limit(requested_run_id uuid)
returns integer language plpgsql stable security definer set search_path='' as $function$
declare execution_policy jsonb;
begin
  execution_policy:=app_data_agent.resolve_falcon24_run_execution_policy(requested_run_id);
  if execution_policy is null then return 5; end if;
  if execution_policy->>'policy_id' is distinct from
      'falcon24-strict-zero-retry@1.0.0'
    or execution_policy->>'mode' is distinct from 'FALCON24_STRICT'
    or execution_policy->>'max_run_attempts' is distinct from '1'
    or execution_policy->>'hold_on_failure' is distinct from 'true'
  then raise exception using errcode='55000',message='RUN_EXECUTION_POLICY_CORRUPT'; end if;
  return 1;
end
$function$;

do $policy_aware_run_work$
declare definition text;
  function_signature constant regprocedure:=
    'app_data_agent.claim_run_work(text,integer,integer)'::pg_catalog.regprocedure;
  exhausted_predicate constant text:='message.attempt_count >= 5';
  retryable_predicate constant text:='message.attempt_count < 5';
  candidate_predicate constant text:='candidate.attempt_count >= 5';
begin
  definition:=pg_catalog.pg_get_functiondef(function_signature);
  if (pg_catalog.length(definition)-pg_catalog.length(
        pg_catalog.replace(definition,exhausted_predicate,'')))
        /pg_catalog.length(exhausted_predicate)<>1
    or (pg_catalog.length(definition)-pg_catalog.length(
        pg_catalog.replace(definition,retryable_predicate,'')))
        /pg_catalog.length(retryable_predicate)<>1
    or (pg_catalog.length(definition)-pg_catalog.length(
        pg_catalog.replace(definition,candidate_predicate,'')))
        /pg_catalog.length(candidate_predicate)<>1
  then raise exception using errcode='55000',message='RUN_WORK_ATTEMPT_BUDGET_SOURCE_DRIFT'; end if;
  definition:=pg_catalog.replace(definition,exhausted_predicate,
    'message.attempt_count >= app_data_agent.resolve_run_delivery_attempt_limit(message.run_id)');
  definition:=pg_catalog.replace(definition,retryable_predicate,
    'message.attempt_count < app_data_agent.resolve_run_delivery_attempt_limit(message.run_id)');
  definition:=pg_catalog.replace(definition,candidate_predicate,
    'candidate.attempt_count >= app_data_agent.resolve_run_delivery_attempt_limit(candidate.run_id)');
  execute definition;
end
$policy_aware_run_work$;
