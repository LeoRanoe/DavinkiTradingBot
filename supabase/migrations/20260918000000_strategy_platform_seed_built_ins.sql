-- Seeds strategy_definitions/strategy_platform_versions rows for the three
-- BUILT_IN registry entries (lib/strategy-platform/registry.ts), so "Use
-- this strategy" (Prompt 2 S16) has a real strategy_version_id to point a
-- StrategyConfiguration at for built-ins, exactly like a USER_DEFINED
-- strategy - without this, only custom strategies could ever be assigned.
--
-- ADDITIVE ONLY. `definition` for a built-in is a pointer, not DSL: its
-- real logic lives in code (lib/strategy-platform/built-in/*.ts), never in
-- this jsonb column - the immutability trigger from the prior migration
-- still applies unchanged.
--
-- Run only if not already seeded (idempotent), and only after
-- 20260917000000_strategy_platform.sql has been applied.

insert into strategy_definitions (slug, display_name, description, type, owner_user_id, visibility)
values
  ('v1', 'Strategy V1 (Legacy Baseline)', 'Frozen research baseline - see docs/STRATEGY_V1.md. Still executes through its own dedicated pipeline, not this registry.', 'BUILT_IN', null, 'PUBLIC'),
  ('jeanfx-v1', 'JeanFX Liquidity System', 'Liquidity sweep -> MSS/BOS -> FVG -> retracement -> confirmation. See docs/strategies/jeanfx-v1-spec.md.', 'BUILT_IN', null, 'PUBLIC'),
  ('v2-trb', 'TRB (Research Benchmark)', 'Placeholder - no TRB algorithm exists in this repository yet.', 'BUILT_IN', null, 'PUBLIC')
on conflict (slug) do nothing;

insert into strategy_platform_versions (strategy_definition_id, version_number, version_label, engine_schema_version, definition, status, created_by)
select d.id, 1, 'v1', '1', jsonb_build_object('builtIn', true, 'slug', d.slug), status_for_slug.status, null
from strategy_definitions d
join (
  values ('v1', 'DRAFT'::strategy_platform_status), ('jeanfx-v1', 'RESEARCH_ONLY'::strategy_platform_status), ('v2-trb', 'DRAFT'::strategy_platform_status)
) as status_for_slug(slug, status) on status_for_slug.slug = d.slug
where d.type = 'BUILT_IN'
  and not exists (
    select 1 from strategy_platform_versions v where v.strategy_definition_id = d.id and v.version_number = 1
  );
