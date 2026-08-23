-- ============================================================
-- 10633: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010633_app_data_agent_operations_admin',
  '__OPERATIONS_ADMIN_MIGRATION_CHECKSUM__'
);

commit;
