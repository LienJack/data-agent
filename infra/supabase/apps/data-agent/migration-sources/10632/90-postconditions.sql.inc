-- ============================================================
-- 10632: Postconditions
-- ============================================================

do $postconditions$
begin
  if exists (
    select 1 from (
      values
        ('semantic_import_jobs'),
        ('semantic_import_mappings'),
        ('semantic_import_operations'),
        ('semantic_import_receipts')
    ) as expected(relation_name)
    where not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_data_agent'
        and relation.relname = expected.relation_name
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    )
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PORTABILITY_RLS_POSTCONDITION_FAILED';
  end if;
  if not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'semantic.read_portable_published_semantic(uuid,uuid,text)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'semantic.read_portability_targets(uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PORTABILITY_BRIDGE_GRANT_MISSING';
  end if;
  if pg_catalog.has_table_privilege(
    'data_agent_backend', 'semantic.semantic_source_release', 'SELECT'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PORTABILITY_RAW_SEMANTIC_GRANT_FORBIDDEN';
  end if;
end
$postconditions$;
