select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010654_app_data_agent_provider_invocation_authority',
  '__PROVIDER_INVOCATION_MIGRATION_CHECKSUM__'
);

commit;
