-- ============================================================
-- 10615: Post-conditions, ledger checksum, and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010615_app_data_agent_semantic_published_bridge',
  '__SEMANTIC_MIGRATION_CHECKSUM__'
);

commit;
