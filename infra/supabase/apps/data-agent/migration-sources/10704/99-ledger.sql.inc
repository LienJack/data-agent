select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010704_app_data_agent_semantic_v2_only',
  '__SEMANTIC_V2_ONLY_MIGRATION_CHECKSUM__'
);

commit;
