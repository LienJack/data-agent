select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010695_app_data_agent_semantic_self_publish_digest_grant',
  '__SEMANTIC_SELF_PUBLISH_DIGEST_GRANT_MIGRATION_CHECKSUM__'
);
commit;
