do $postconditions$ begin
  if not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_publish_attempt'::regclass
        and tgname='semantic_publish_attempt_projection_reuse' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_source_release'::regclass
        and tgname='semantic_source_release_projection_reuse' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_executable_projection'::regclass
        and tgname='semantic_executable_projection_reuse' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_relationship_projection'::regclass
        and tgname='semantic_relationship_projection_reuse' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_runtime_restriction_projection'::regclass
        and tgname='semantic_restriction_projection_reuse' and not tgisinternal)
  then raise exception using errcode='P0001',message='SEMANTIC_PROJECTION_REUSE_POSTCONDITION_FAILED'; end if;
end $postconditions$;
