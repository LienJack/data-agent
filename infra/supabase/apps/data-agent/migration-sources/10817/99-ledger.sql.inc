select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010817_app_data_agent_falcon24_four_layer_manifest_v2',
  '__FALCON24_FOUR_LAYER_MANIFEST_V2_MIGRATION_CHECKSUM__');
commit;
