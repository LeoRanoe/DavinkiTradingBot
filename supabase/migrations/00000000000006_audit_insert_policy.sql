-- Authenticated users may write audit log entries for their own dashboard
-- actions (mode changes, credential updates, signal approve/reject). This
-- mirrors the existing single-user-app model (system_settings/signals
-- already allow authenticated UPDATE) - audit_events remains append-only
-- (no update/delete policy) and still fully readable via the existing
-- authenticated_read policy.
create policy "authenticated_insert" on audit_events for insert to authenticated with check (true);
