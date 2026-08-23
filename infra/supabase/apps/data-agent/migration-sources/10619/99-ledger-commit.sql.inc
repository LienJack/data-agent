-- ============================================================
-- 10619 ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010619_app_data_agent_attribution_canonical_compatibility',
  '__ATTRIBUTION_COMPATIBILITY_MIGRATION_CHECKSUM__'
);

commit;
