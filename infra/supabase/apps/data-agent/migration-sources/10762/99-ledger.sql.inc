select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010762_app_data_agent_model_status_retirement_repair',
  '__MODEL_STATUS_RETIREMENT_REPAIR_MIGRATION_CHECKSUM__');
commit;
