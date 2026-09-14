-- Shadow / counterfactual research sources.
--
-- ADDITIVE ONLY. The source constraint is WIDENED, never narrowed: every
-- existing value stays valid and existing rows are untouched.
--
-- `counterfactual_outcomes.is_hypothetical` already carries CHECK
-- (is_hypothetical), so a row in this table can NEVER be an actual outcome.
-- That is the structural guarantee the whole shadow programme rests on -
-- these rows can be aggregated, charted and reasoned about freely without any
-- risk of one leaking into PAPER equity or actual performance.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'counterfactual_outcomes_source_check') then
    alter table public.counterfactual_outcomes drop constraint counterfactual_outcomes_source_check;
  end if;

  alter table public.counterfactual_outcomes add constraint counterfactual_outcomes_source_check
    check (source in (
      -- Existing, unchanged.
      'OWNER_REJECTED',      -- the owner declined it
      'RISK_BLOCKED',        -- the deterministic risk layer refused it
      -- New shadow-research sources.
      'SCORE_BAND_SHADOW',   -- scored below CANDIDATE (LOG/WATCH): band research
      'CANDIDATE_EXPIRED',   -- reached PENDING but was never acted on in time
      'ENTRY_DRIFT'          -- price left the allowed entry range before execution
    ));
end $$;

-- Research context, so a counterfactual can be analysed the same way an
-- actual trade can. All nullable: existing rows keep NULL and nothing is
-- rewritten.
alter table public.counterfactual_outcomes
  add column if not exists research_session_id uuid references public.paper_research_sessions(id),
  add column if not exists score integer,
  add column if not exists score_band text,
  add column if not exists symbol text,
  add column if not exists regime text;

create index if not exists counterfactual_research_session_idx
  on public.counterfactual_outcomes (research_session_id)
  where research_session_id is not null;
create index if not exists counterfactual_source_idx
  on public.counterfactual_outcomes (source);

-- The scanner settles counterfactuals as part of its research pass, so it
-- needs to update the rows it queued. It already holds INSERT.
drop policy if exists scanner_update_counterfactual_outcomes on public.counterfactual_outcomes;
create policy scanner_update_counterfactual_outcomes on public.counterfactual_outcomes
  for update to authenticated
  using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner')
  with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'scanner');

comment on table public.counterfactual_outcomes is
  'Hypothetical outcomes for setups that were NOT traded. CHECK (is_hypothetical) makes it structurally impossible for a row here to be an actual result: nothing in this table may ever affect PAPER equity, realized P/L, or actual strategy performance. It exists to answer whether the filters are rejecting noise or rejecting edge.';
comment on column public.counterfactual_outcomes.source is
  'Why this setup was not traded. Preserved exactly so the research can distinguish an owner decision from a risk block, a sub-threshold score, an expiry, and price leaving the entry range.';
