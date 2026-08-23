-- ============================================================
-- 10623: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010623_app_data_agent_schema_discovery',
  '__SCHEMA_DISCOVERY_MIGRATION_CHECKSUM__'
);

commit;
