-- ============================================================
-- 10635: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010635_app_data_agent_superadmin_email_sync',
  '__SUPERADMIN_EMAIL_SYNC_MIGRATION_CHECKSUM__'
);

commit;
