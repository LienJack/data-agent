select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010687_app_data_agent_semantic_provider_validator_grant',
  '__SEMANTIC_PROVIDER_VALIDATOR_GRANT_MIGRATION_CHECKSUM__'
);
commit;
