select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010754_app_data_agent_analysis_lifecycle_capability_envelope_repair',
  '__ANALYSIS_LIFECYCLE_CAPABILITY_ENVELOPE_REPAIR_MIGRATION_CHECKSUM__');
commit;
