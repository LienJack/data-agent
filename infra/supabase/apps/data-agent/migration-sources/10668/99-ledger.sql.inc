select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010668_app_data_agent_datasource_adapters','__U16_DATASOURCE_ADAPTER_MIGRATION_CHECKSUM__');
commit;
