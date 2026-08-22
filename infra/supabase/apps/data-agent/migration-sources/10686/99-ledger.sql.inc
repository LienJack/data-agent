select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010686_app_data_agent_knowledge_evidence_revision_repair',
  '__KNOWLEDGE_EVIDENCE_REVISION_REPAIR_MIGRATION_CHECKSUM__'
);
commit;
