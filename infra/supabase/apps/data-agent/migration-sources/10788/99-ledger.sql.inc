select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010788_app_data_agent_root_default_policy_compatibility',
  '__ROOT_DEFAULT_POLICY_COMPATIBILITY_MIGRATION_CHECKSUM__');
commit;
