select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010649_app_data_agent_model_provider_connections',
  '__MODEL_PROVIDER_CONNECTION_MIGRATION_CHECKSUM__'
);

commit;
