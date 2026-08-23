select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010651_app_data_agent_environment_model_availability',
  '__ENVIRONMENT_MODEL_AVAILABILITY_MIGRATION_CHECKSUM__'
);

commit;
