-- ============================================================
-- 10628: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010628_app_data_agent_workspace_data_isolation',
  '__WORKSPACE_DATA_ISOLATION_MIGRATION_CHECKSUM__'
);

commit;
