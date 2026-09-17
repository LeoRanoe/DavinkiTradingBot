-- Multi-strategy platform foundation.
--
-- ADDITIVE ONLY. Nothing existing is altered, renamed, or dropped.
--
-- Compatibility decision (see docs/architecture/strategy-platform.md
-- "Migration safety"): the legacy `strategy_versions` table stays exactly
-- as it is and keeps serving V1's `signals`/`trades`/`backtests` foreign
-- keys unchanged. It is NOT renamed, reused, or repointed. This platform
-- introduces its own `strategy_platform_versions` table with a different
-- shape (immutable definition snapshot, explicit definition/ownership
-- model) rather than overloading the legacy one. A future adapter can map
-- V1's single legacy row onto one `strategy_definitions`/
-- `strategy_platform_versions` pair for discoverability if ever needed;
-- this migration does not attempt that mapping.

create type strategy_definition_type as enum ('BUILT_IN', 'USER_DEFINED');
create type strategy_platform_status as enum (
  'DRAFT', 'RESEARCH_ONLY', 'PAPER_ELIGIBLE', 'PAPER_ACTIVE', 'LIVE_ELIGIBLE', 'ARCHIVED'
);
create type strategy_assignment_mode as enum ('RESEARCH', 'SHADOW', 'PAPER', 'LIVE');
create type strategy_visibility as enum ('PRIVATE', 'UNLISTED', 'PUBLIC');

-- ---------------------------------------------------------------------------
-- strategy_definitions
-- ---------------------------------------------------------------------------
create table strategy_definitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  description text,
  type strategy_definition_type not null,
  -- NULL = system/built-in strategy; non-null = belongs to that user.
  owner_user_id uuid references profiles(id),
  -- Future marketplace visibility (S17 of the platform brief); defaults
  -- PRIVATE so nothing behaves differently until a later checkpoint
  -- deliberately changes it. No marketplace functionality is built now.
  visibility strategy_visibility not null default 'PRIVATE',
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint built_in_has_no_owner check (
    (type = 'BUILT_IN' and owner_user_id is null) or
    (type = 'USER_DEFINED' and owner_user_id is not null)
  )
);
create index strategy_definitions_owner_idx on strategy_definitions (owner_user_id);

-- ---------------------------------------------------------------------------
-- strategy_platform_versions: immutable definition snapshots.
-- See the compatibility note above - this is NOT the legacy strategy_versions.
-- ---------------------------------------------------------------------------
create table strategy_platform_versions (
  id uuid primary key default gen_random_uuid(),
  strategy_definition_id uuid not null references strategy_definitions(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  version_label text not null,
  engine_schema_version text not null default '1',
  -- Immutable snapshot: DSL rules for USER_DEFINED, or a pointer/parameter
  -- record for BUILT_IN strategies whose actual logic lives in code
  -- (lib/strategy-platform/built-in/*). Enforced immutable below.
  definition jsonb not null,
  status strategy_platform_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id),
  archived_at timestamptz,
  unique (strategy_definition_id, version_number)
);
create index strategy_platform_versions_definition_idx on strategy_platform_versions (strategy_definition_id);

-- Immutability: once a version row exists, only `status` and `archived_at`
-- may ever change. This mirrors CLAUDE.md's "strategy versions are
-- immutable" rule and lib/strategy-platform/authorization.ts
-- assertVersionMutationAllowed(), which application code should use as a
-- pre-check before even attempting the update this trigger will reject.
create function strategy_platform_versions_block_mutation() returns trigger
language plpgsql as $$
begin
  if new.strategy_definition_id is distinct from old.strategy_definition_id
     or new.version_number is distinct from old.version_number
     or new.version_label is distinct from old.version_label
     or new.engine_schema_version is distinct from old.engine_schema_version
     or new.definition is distinct from old.definition
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by
  then
    raise exception 'strategy_platform_versions rows are immutable except status/archived_at';
  end if;
  return new;
end;
$$;

create trigger strategy_platform_versions_immutable
  before update on strategy_platform_versions
  for each row execute function strategy_platform_versions_block_mutation();

-- ---------------------------------------------------------------------------
-- strategy_configurations: how a specific user wants to run a version.
-- ---------------------------------------------------------------------------
create table strategy_configurations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  strategy_version_id uuid not null references strategy_platform_versions(id),
  name text not null,
  -- Validated in application code against the version's parameterSchema
  -- (embedded in strategy_platform_versions.definition) before insert -
  -- see lib/strategy-platform/dsl/validate.ts. Postgres only guarantees
  -- shape (jsonb), not schema conformance.
  parameters jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, strategy_version_id, name)
);
create index strategy_configurations_user_idx on strategy_configurations (user_id);

-- ---------------------------------------------------------------------------
-- strategy_assignments: a configuration does not run just because it exists.
-- ---------------------------------------------------------------------------
create table strategy_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id),
  strategy_configuration_id uuid not null references strategy_configurations(id) on delete cascade,
  instrument_ids text[] not null default '{}',
  mode strategy_assignment_mode not null default 'RESEARCH',
  enabled boolean not null default true,
  priority integer not null default 100,
  -- Explicit authorization layer for PAPER (S8/S15/S16 of the platform
  -- brief: execution modes require authorization; a strategy - built-in or
  -- user-defined - can never authorize itself). Only an owner-role update
  -- may set this (see RLS below); a PAPER row without it is invalid.
  paper_authorized_by uuid references profiles(id),
  paper_authorized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Defense in depth mirroring CLAUDE.md's LIVE-disabled invariant: even a
  -- compromised client can never make a strategy_assignments row LIVE.
  -- This is an ADDITIONAL layer scoped to this new table - it does not
  -- replace or touch the three existing LIVE-disable layers documented in
  -- CLAUDE.md, which remain exactly as they are.
  constraint strategy_assignments_live_forbidden check (mode <> 'LIVE'),
  constraint strategy_assignments_paper_requires_authorization check (
    mode <> 'PAPER' or paper_authorized_by is not null
  )
);
create index strategy_assignments_user_idx on strategy_assignments (user_id);
create index strategy_assignments_configuration_idx on strategy_assignments (strategy_configuration_id);

-- Column-level protection RLS can't express on its own: only the owner
-- role may ever set/change paper_authorized_by / paper_authorized_at, on
-- insert or update, regardless of which RLS policy let the statement
-- through. This is what lets the plain per-user CRUD policy below stay
-- simple (a self-update that leaves authorization untouched is always
-- fine) while still making self-service PAPER authorization impossible.
create function strategy_assignments_protect_authorization() returns trigger
language plpgsql as $$
declare
  requester_role text := (select auth.jwt())->'app_metadata'->>'role';
begin
  if new.mode = 'LIVE' then
    raise exception 'LIVE mode is never permitted on strategy_assignments';
  end if;
  if (tg_op = 'INSERT' and new.paper_authorized_by is not null)
     or (tg_op = 'UPDATE' and new.paper_authorized_by is distinct from old.paper_authorized_by)
     or (tg_op = 'UPDATE' and new.paper_authorized_at is distinct from old.paper_authorized_at)
  then
    if requester_role <> 'owner' then
      raise exception 'only the owner role may set PAPER authorization on a strategy assignment';
    end if;
  end if;
  return new;
end;
$$;

create trigger strategy_assignments_protect_authorization
  before insert or update on strategy_assignments
  for each row execute function strategy_assignments_protect_authorization();

-- Known limitation, documented rather than silently assumed: the RLS policy
-- below still requires user_id = auth.uid() for ANY write, including the
-- owner authorizing PAPER. That is correct for today's single-owner app
-- (the owner authorizes their own assignment). A true multi-tenant flow
-- where the owner authorizes a DIFFERENT user's assignment needs an
-- additional RLS carve-out (an "or role = 'owner'" write path) on top of
-- this trigger - not added here since no second non-guest user exists yet.

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table strategy_definitions enable row level security;
alter table strategy_platform_versions enable row level security;
alter table strategy_configurations enable row level security;
alter table strategy_assignments enable row level security;

-- Read: built-ins and public/unlisted-future strategies are visible to any
-- authenticated user (including guests, read-only as everywhere else in
-- this app); a private USER_DEFINED strategy is visible only to its owner.
create policy "strategy_definitions_select" on strategy_definitions
  for select to authenticated
  using (type = 'BUILT_IN' or visibility = 'PUBLIC' or owner_user_id = (select auth.uid()));

-- Write: only a non-guest user may create their own USER_DEFINED strategy.
-- Built-in rows are never insertable through this policy (type = 'BUILT_IN'
-- fails the check for every authenticated client); they are seeded by
-- migrations/service-role code only.
create policy "strategy_definitions_insert" on strategy_definitions
  for insert to authenticated
  with check (
    type = 'USER_DEFINED'
    and owner_user_id = (select auth.uid())
    and (select auth.jwt())->'app_metadata'->>'role' <> 'guest'
  );

create policy "strategy_definitions_update" on strategy_definitions
  for update to authenticated
  using (
    type = 'USER_DEFINED'
    and owner_user_id = (select auth.uid())
    and (select auth.jwt())->'app_metadata'->>'role' <> 'guest'
  )
  with check (
    type = 'USER_DEFINED'
    and owner_user_id = (select auth.uid())
  );

create policy "strategy_platform_versions_select" on strategy_platform_versions
  for select to authenticated
  using (
    strategy_definition_id in (
      select id from strategy_definitions
      where type = 'BUILT_IN' or visibility = 'PUBLIC' or owner_user_id = (select auth.uid())
    )
  );

-- Insert only: version rows are immutable (see trigger above), so no update
-- policy is granted beyond what the trigger itself would reject anyway -
-- keeping RLS and the trigger as two independent layers.
create policy "strategy_platform_versions_insert" on strategy_platform_versions
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select auth.jwt())->'app_metadata'->>'role' <> 'guest'
    and strategy_definition_id in (
      select id from strategy_definitions
      where type = 'USER_DEFINED' and owner_user_id = (select auth.uid())
    )
  );

-- Status/archived_at progression (DRAFT -> RESEARCH_ONLY -> ...) by the
-- owning user; the trigger still blocks any attempt to touch the
-- definition snapshot itself regardless of this policy.
create policy "strategy_platform_versions_update" on strategy_platform_versions
  for update to authenticated
  using (
    (select auth.jwt())->'app_metadata'->>'role' <> 'guest'
    and strategy_definition_id in (
      select id from strategy_definitions
      where type = 'USER_DEFINED' and owner_user_id = (select auth.uid())
    )
  );

create policy "strategy_configurations_all" on strategy_configurations
  for all to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt())->'app_metadata'->>'role' <> 'guest')
  with check (user_id = (select auth.uid()) and (select auth.jwt())->'app_metadata'->>'role' <> 'guest');

-- Assignments: plain owner-of-row CRUD. The authorization trigger above
-- (not RLS) is what actually stops a self-service PAPER authorization, so
-- this policy can stay simple without blocking routine self-updates
-- (toggling enabled/priority/instruments) on an already-authorized row.
-- Also enforced at the application layer:
-- lib/strategy-platform/authorization.ts canSetAssignmentMode /
-- canAuthorizePaperMode, the same two-layer pattern as the rest of this
-- migration.
create policy "strategy_assignments_all" on strategy_assignments
  for all to authenticated
  using (user_id = (select auth.uid()) and (select auth.jwt())->'app_metadata'->>'role' <> 'guest')
  with check (user_id = (select auth.uid()) and (select auth.jwt())->'app_metadata'->>'role' <> 'guest');

-- No anonymous policies anywhere above: default-deny covers anon/public.
