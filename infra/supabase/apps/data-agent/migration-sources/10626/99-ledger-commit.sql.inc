-- ============================================================
-- 10626: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010626_app_data_agent_semantic_candidate_compile',
  '__SEMANTIC_CANDIDATE_COMPILE_MIGRATION_CHECKSUM__'
);

commit;
