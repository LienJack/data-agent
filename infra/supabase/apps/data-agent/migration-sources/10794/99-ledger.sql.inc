select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010794_app_data_agent_falcon24_semantic_dependency_provisioning',
  '__FALCON24_SEMANTIC_DEPENDENCY_PROVISIONING_MIGRATION_CHECKSUM__');

commit;
