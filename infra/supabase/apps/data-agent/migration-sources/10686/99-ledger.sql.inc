select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010686_app_data_agent_semantic_revision_pointer_read_repair',
  '__SEMANTIC_REVISION_POINTER_READ_REPAIR_MIGRATION_CHECKSUM__'
);
commit;
