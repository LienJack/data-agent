-- ============================================================
-- 10620: Post-conditions, ledger checksum, and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010620_app_data_agent_contribution_authority',
  '__CONTRIBUTION_MIGRATION_CHECKSUM__'
);

commit;
