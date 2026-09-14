-- Scanner audit trail for automatic execution.
--
-- ADDITIVE ONLY. The existing owner_insert_audit policy is untouched; this
-- adds a second INSERT policy alongside it (Postgres ORs permissive policies).
--
-- Why this is needed: with AUTO, the scanner principal is the one that
-- executes a candidate, so it is also the one that must record
-- `paper_auto_execution`, `candidate_execution_rejected` and
-- `paper_research_period_ended`. Without this policy those writes are
-- silently refused by RLS and the audit trail for automatically executed
-- trades is simply missing - the trade would exist with no recorded reason.
--
-- The grant is INSERT only. The scanner still cannot read, update or delete
-- audit history, so it cannot rewrite the record of what it did.
drop policy if exists scanner_insert_audit on public.audit_events;
create policy scanner_insert_audit on public.audit_events
  for insert to authenticated
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');

comment on table public.audit_events is
  'Append-only operational audit trail. Both the owner and the scanner may INSERT; neither may UPDATE or DELETE, so a recorded action cannot later be rewritten.';
