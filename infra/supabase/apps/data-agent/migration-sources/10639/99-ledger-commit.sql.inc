-- ============================================================
-- 10639: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010639_app_data_agent_semantic_authoring',
  '__SEMANTIC_AUTHORING_MIGRATION_CHECKSUM__'
);

commit;
