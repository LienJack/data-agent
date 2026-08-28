select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010793_app_data_agent_falcon24_successor_review_policy_provisioning',
  '__FALCON24_SUCCESSOR_REVIEW_POLICY_PROVISIONING_MIGRATION_CHECKSUM__');

commit;
