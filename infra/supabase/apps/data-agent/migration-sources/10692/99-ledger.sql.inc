select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010692_app_data_agent_resolved_context_promotion_repair',
  '__RESOLVED_CONTEXT_PROMOTION_REPAIR_MIGRATION_CHECKSUM__'
);
commit;
