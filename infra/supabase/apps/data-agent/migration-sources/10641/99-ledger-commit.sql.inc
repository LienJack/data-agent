select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010641_app_data_agent_semantic_authoring_queue',
  '__SEMANTIC_AUTHORING_QUEUE_MIGRATION_CHECKSUM__'
);

commit;
