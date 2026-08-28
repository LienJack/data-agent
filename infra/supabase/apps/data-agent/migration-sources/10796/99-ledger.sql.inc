select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010796_app_data_agent_semantic_successor_smoke_revalidation',
  '__SEMANTIC_SUCCESSOR_SMOKE_REVALIDATION_MIGRATION_CHECKSUM__');

commit;
