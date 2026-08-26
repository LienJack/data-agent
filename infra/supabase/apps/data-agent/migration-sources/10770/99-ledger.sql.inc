select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010770_app_data_agent_falcon24_submit_outcome_authority',
  '__FALCON24_SUBMIT_OUTCOME_AUTHORITY_MIGRATION_CHECKSUM__');
commit;
