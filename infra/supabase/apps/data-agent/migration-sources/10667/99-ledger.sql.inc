select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010667_app_data_agent_agent_product_profiles','__U20_AGENT_PROFILE_MIGRATION_CHECKSUM__');
commit;
