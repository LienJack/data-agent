select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010659_app_data_agent_job_center',
  '__JOB_CENTER_MIGRATION_CHECKSUM__'
);

commit;
