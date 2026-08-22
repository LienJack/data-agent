select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010694_app_data_agent_semantic_revision_evidence_read',
  '__SEMANTIC_REVISION_EVIDENCE_READ_MIGRATION_CHECKSUM__'
);
commit;
