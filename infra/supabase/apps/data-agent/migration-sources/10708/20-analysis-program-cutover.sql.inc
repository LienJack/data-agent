do $analysis_program_rpc$
declare definition text; rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_current_analysis_artifact(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,$$when 'AnalysisPlan' then 'PLANNING'$$)=0
  then raise exception using errcode='P0001',message='ANALYSIS_PROGRAM_RPC_BASELINE_DRIFT'; end if;
  rewritten:=pg_catalog.replace(definition,'AnalysisPlan','AnalysisProgram');
  execute rewritten;
end
$analysis_program_rpc$;

drop policy artifacts_u6_reserved_insert_deny on app_data_agent.artifacts;
drop policy artifacts_u6_reserved_update_deny on app_data_agent.artifacts;
drop policy artifacts_u6_reserved_delete_deny on app_data_agent.artifacts;

create policy artifacts_u6_reserved_insert_deny
on app_data_agent.artifacts as restrictive for insert to data_agent_backend
with check (artifact_type not in (
  'ResearchBrief', 'HypothesisSet', 'EvidencePlan', 'ObligationExecutionDecision',
  'QueryEvidence', 'DataProfile', 'AnalysisProgram', 'DerivedAnalysisEvidence',
  'AnalysisCompletionReceipt', 'AtomicClaim', 'EvidenceRelation', 'EvidenceCheckReceipt',
  'SupportDecision', 'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
  'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt', 'EvidenceGateReceipt',
  'ReportReadyCertificate', 'ReadinessRevocationReceipt'
));
create policy artifacts_u6_reserved_update_deny
on app_data_agent.artifacts as restrictive for update to data_agent_backend
using (artifact_type not in (
  'ResearchBrief', 'HypothesisSet', 'EvidencePlan', 'ObligationExecutionDecision',
  'QueryEvidence', 'DataProfile', 'AnalysisProgram', 'DerivedAnalysisEvidence',
  'AnalysisCompletionReceipt', 'AtomicClaim', 'EvidenceRelation', 'EvidenceCheckReceipt',
  'SupportDecision', 'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
  'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt', 'EvidenceGateReceipt',
  'ReportReadyCertificate', 'ReadinessRevocationReceipt'
)) with check (artifact_type not in (
  'ResearchBrief', 'HypothesisSet', 'EvidencePlan', 'ObligationExecutionDecision',
  'QueryEvidence', 'DataProfile', 'AnalysisProgram', 'DerivedAnalysisEvidence',
  'AnalysisCompletionReceipt', 'AtomicClaim', 'EvidenceRelation', 'EvidenceCheckReceipt',
  'SupportDecision', 'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
  'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt', 'EvidenceGateReceipt',
  'ReportReadyCertificate', 'ReadinessRevocationReceipt'
));
create policy artifacts_u6_reserved_delete_deny
on app_data_agent.artifacts as restrictive for delete to data_agent_backend
using (artifact_type not in (
  'ResearchBrief', 'HypothesisSet', 'EvidencePlan', 'ObligationExecutionDecision',
  'QueryEvidence', 'DataProfile', 'AnalysisProgram', 'DerivedAnalysisEvidence',
  'AnalysisCompletionReceipt', 'AtomicClaim', 'EvidenceRelation', 'EvidenceCheckReceipt',
  'SupportDecision', 'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
  'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt', 'EvidenceGateReceipt',
  'ReportReadyCertificate', 'ReadinessRevocationReceipt'
));
