-- RLS audit finding (Prompt 3 S27): strategy_configurations' insert/update
-- policy from 20260917000000_strategy_platform.sql checks `user_id =
-- auth.uid()` but never checks that `strategy_version_id` actually points
-- at a version the inserting user is allowed to READ. A user could create
-- a configuration referencing another user's PRIVATE strategy version by
-- UUID, without ever reading its content directly - a foreign-key-level
-- authorization gap, not caught by the row-ownership check alone.
--
-- ADDITIVE ONLY. Replaces the single `strategy_configurations_all` policy
-- with the same ownership check PLUS a subquery constraining
-- strategy_version_id to versions of a BUILT_IN, PUBLIC, or
-- self-owned USER_DEFINED strategy_definitions row - exactly the same
-- visibility rule strategy_platform_versions_select already enforces for
-- direct reads, now also enforced on this foreign key.

drop policy if exists "strategy_configurations_all" on strategy_configurations;

create policy "strategy_configurations_select" on strategy_configurations
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "strategy_configurations_insert" on strategy_configurations
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select auth.jwt())->'app_metadata'->>'role' <> 'guest'
    and strategy_version_id in (
      select v.id from strategy_platform_versions v
      join strategy_definitions d on d.id = v.strategy_definition_id
      where d.type = 'BUILT_IN' or d.visibility = 'PUBLIC' or d.owner_user_id = (select auth.uid())
    )
  );

create policy "strategy_configurations_update" on strategy_configurations
  for update to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt())->'app_metadata'->>'role' <> 'guest')
  with check (
    user_id = (select auth.uid())
    and strategy_version_id in (
      select v.id from strategy_platform_versions v
      join strategy_definitions d on d.id = v.strategy_definition_id
      where d.type = 'BUILT_IN' or d.visibility = 'PUBLIC' or d.owner_user_id = (select auth.uid())
    )
  );

create policy "strategy_configurations_delete" on strategy_configurations
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt())->'app_metadata'->>'role' <> 'guest');

-- Second instance of the same class of gap: strategy_assignments'
-- `strategy_assignments_all` policy (Prompt 1 migration) checks
-- `user_id = auth.uid()` on the assignment row itself, but never that
-- `strategy_configuration_id` actually belongs to that same user - a
-- crafted insert could set user_id to self while pointing
-- strategy_configuration_id at ANOTHER user's configuration (and, through
-- it, their strategy version). Fixed the same way: constrain the foreign
-- key to configurations owned by the inserting/updating user. The
-- authorization-protection trigger from the Prompt 1 migration
-- (strategy_assignments_protect_authorization) is unaffected - it still
-- runs on every insert/update regardless of which policy admitted it.

drop policy if exists "strategy_assignments_all" on strategy_assignments;

create policy "strategy_assignments_select" on strategy_assignments
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "strategy_assignments_insert" on strategy_assignments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (select auth.jwt())->'app_metadata'->>'role' <> 'guest'
    and strategy_configuration_id in (select id from strategy_configurations where user_id = (select auth.uid()))
  );

create policy "strategy_assignments_update" on strategy_assignments
  for update to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt())->'app_metadata'->>'role' <> 'guest')
  with check (
    user_id = (select auth.uid())
    and strategy_configuration_id in (select id from strategy_configurations where user_id = (select auth.uid()))
  );

create policy "strategy_assignments_delete" on strategy_assignments
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt())->'app_metadata'->>'role' <> 'guest');

-- With both fixes, the full chain (assignment -> configuration -> version
-- -> definition) is closed: at every step, RLS constrains the referenced
-- row to one the inserting/updating user can actually read.
