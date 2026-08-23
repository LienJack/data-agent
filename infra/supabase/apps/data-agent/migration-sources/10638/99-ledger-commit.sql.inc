-- ============================================================
-- 10638: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010638_app_data_agent_semantic_graph_v2',
  '__SEMANTIC_GRAPH_V2_MIGRATION_CHECKSUM__'
);

commit;
