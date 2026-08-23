-- ============================================================
-- 10632: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010632_app_data_agent_semantic_json_portability',
  '__SEMANTIC_JSON_PORTABILITY_MIGRATION_CHECKSUM__'
);

commit;
