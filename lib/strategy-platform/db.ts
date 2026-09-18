import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Typed row shapes for the new strategy-platform tables
 * (supabase/migrations/20260917000000_strategy_platform.sql), used until
 * `lib/supabase/database.types.ts` is regenerated against the live schema
 * once that migration is applied (see docs/architecture/strategy-platform.md
 * "Migration safety" - it is deliberately NOT applied yet). Queries below
 * cast the Supabase client to `any` for just these table names rather than
 * hand-maintaining a fake edit to the generated types file. Every write
 * still goes through the RLS-respecting client
 * (`lib/supabase/server.ts`/`client.ts`), never the admin client - RLS is
 * the real enforcement boundary either way.
 */

export type StrategyDefinitionRow = {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  type: "BUILT_IN" | "USER_DEFINED";
  owner_user_id: string | null;
  visibility: "PRIVATE" | "UNLISTED" | "PUBLIC";
  created_at: string;
  archived_at: string | null;
};

export type StrategyPlatformVersionRow = {
  id: string;
  strategy_definition_id: string;
  version_number: number;
  version_label: string;
  engine_schema_version: string;
  definition: unknown;
  status: string;
  created_at: string;
  created_by: string | null;
  archived_at: string | null;
};

export type StrategyConfigurationRow = {
  id: string;
  user_id: string;
  strategy_version_id: string;
  name: string;
  parameters: unknown;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type StrategyAssignmentRow = {
  id: string;
  user_id: string;
  strategy_configuration_id: string;
  instrument_ids: string[];
  mode: "RESEARCH" | "SHADOW" | "PAPER" | "LIVE";
  enabled: boolean;
  priority: number;
  paper_authorized_by: string | null;
  paper_authorized_at: string | null;
  created_at: string;
  updated_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

export async function listUserStrategyDefinitions(supabase: AnyClient, userId: string) {
  return supabase.from("strategy_definitions").select("*").eq("owner_user_id", userId).is("archived_at", null).order("created_at", { ascending: false }) as unknown as Promise<{
    data: StrategyDefinitionRow[] | null;
    error: { message: string } | null;
  }>;
}

export async function listStrategyVersions(supabase: AnyClient, strategyDefinitionId: string) {
  return supabase
    .from("strategy_platform_versions")
    .select("*")
    .eq("strategy_definition_id", strategyDefinitionId)
    .order("version_number", { ascending: false }) as unknown as Promise<{ data: StrategyPlatformVersionRow[] | null; error: { message: string } | null }>;
}

export async function listConfigurationsForVersion(supabase: AnyClient, strategyVersionId: string, userId: string) {
  return supabase
    .from("strategy_configurations")
    .select("*")
    .eq("strategy_version_id", strategyVersionId)
    .eq("user_id", userId) as unknown as Promise<{ data: StrategyConfigurationRow[] | null; error: { message: string } | null }>;
}

export async function listAssignmentsForConfiguration(supabase: AnyClient, strategyConfigurationId: string, userId: string) {
  return supabase
    .from("strategy_assignments")
    .select("*")
    .eq("strategy_configuration_id", strategyConfigurationId)
    .eq("user_id", userId) as unknown as Promise<{ data: StrategyAssignmentRow[] | null; error: { message: string } | null }>;
}

/** True when the error looks like "relation does not exist" - i.e. the migration hasn't been applied yet, not a real failure. */
export function isMissingTableError(error: { message: string } | null): boolean {
  return !!error && /relation .* does not exist/i.test(error.message);
}
