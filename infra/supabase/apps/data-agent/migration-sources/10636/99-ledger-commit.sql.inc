-- ============================================================
-- 10636: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010636_app_data_agent_adb_ecommerce_demo',
  '__ADB_ECOMMERCE_MIGRATION_CHECKSUM__'
);

commit;
