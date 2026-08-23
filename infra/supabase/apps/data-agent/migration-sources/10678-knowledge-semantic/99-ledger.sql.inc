select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010678_app_data_agent_knowledge_evidence_authority_repair',
  '__KNOWLEDGE_EVIDENCE_AUTHORITY_REPAIR_MIGRATION_CHECKSUM__'
);
commit;
