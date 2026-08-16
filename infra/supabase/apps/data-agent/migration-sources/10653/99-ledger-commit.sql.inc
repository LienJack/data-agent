select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010653_app_data_agent_effective_run_config',
  '__EFFECTIVE_RUN_CONFIG_MIGRATION_CHECKSUM__'
);

commit;
