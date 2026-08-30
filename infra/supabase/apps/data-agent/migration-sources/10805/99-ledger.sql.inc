select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010805_app_data_agent_falcon24_fence_token_secret_guard',
  '__FALCON24_FENCE_TOKEN_SECRET_GUARD_MIGRATION_CHECKSUM__');

commit;
