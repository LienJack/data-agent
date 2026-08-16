select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010652_app_data_agent_environment_model_sync_concurrency',
  '__ENVIRONMENT_MODEL_SYNC_CONCURRENCY_MIGRATION_CHECKSUM__'
);

commit;
