-- ============================================================
-- 10624: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010624_app_data_agent_semantic_explorer',
  '__SEMANTIC_EXPLORER_MIGRATION_CHECKSUM__'
);

commit;
