select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010800_app_data_agent_falcon24_e8_provider_binding',
  '__FALCON24_E8_PROVIDER_BINDING_MIGRATION_CHECKSUM__');

commit;
