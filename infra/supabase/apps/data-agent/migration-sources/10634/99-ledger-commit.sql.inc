-- ============================================================
-- 10634: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010634_app_data_agent_username_login',
  '__USERNAME_LOGIN_MIGRATION_CHECKSUM__'
);

commit;
