select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010772_app_data_agent_falcon24_submit_outcome_coalesce_repair',
  '__FALCON24_SUBMIT_OUTCOME_COALESCE_REPAIR_MIGRATION_CHECKSUM__');
commit;
