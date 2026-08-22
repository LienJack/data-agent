select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010690_app_data_agent_semantic_projection_reuse',
  '__SEMANTIC_PROJECTION_REUSE_MIGRATION_CHECKSUM__'
);
commit;
