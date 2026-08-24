do $postconditions$
begin
  if pg_catalog.to_regprocedure('app_data_agent.commit_governed_operator_result(jsonb,bytea)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.commit_governed_operator_result(jsonb,bytea,bytea)') is null
    or pg_catalog.to_regprocedure('app_data_agent.read_governed_operator_result(jsonb)') is null
    or not exists(
      select 1 from pg_catalog.pg_attribute
      where attrelid='app_data_agent.analysis_operator_results'::pg_catalog.regclass
        and attname='request_content' and attnum>0 and not attisdropped and attnotnull
    )
  then raise exception using errcode='P0001',message='ANALYSIS_OPERATOR_REQUEST_AUTHORITY_NOT_INSTALLED'; end if;
end
$postconditions$;
