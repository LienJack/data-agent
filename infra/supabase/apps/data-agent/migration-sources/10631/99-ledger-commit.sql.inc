-- ============================================================
-- 10631: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010631_app_data_agent_model_billing_settlement',
  '__MODEL_BILLING_SETTLEMENT_MIGRATION_CHECKSUM__'
);

commit;
