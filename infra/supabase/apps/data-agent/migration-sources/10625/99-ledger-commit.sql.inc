-- ============================================================
-- 10625: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010625_app_data_agent_semantic_relationship_index',
  '__SEMANTIC_RELATIONSHIP_INDEX_MIGRATION_CHECKSUM__'
);

commit;
