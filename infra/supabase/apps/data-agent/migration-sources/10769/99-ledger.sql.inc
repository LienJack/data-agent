select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010769_app_data_agent_falcon24_trace_gate_authority',
  '__FALCON24_TRACE_GATE_AUTHORITY_MIGRATION_CHECKSUM__');
commit;
