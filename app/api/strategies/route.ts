import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth/authorization";
import { validateDslDefinition } from "@/lib/strategy-platform/dsl/validate";
import { assertImportTargetSlugIsSafe } from "@/lib/strategy-platform/import-export";
import { BUILT_IN_STRATEGIES } from "@/lib/strategy-platform/registry";
import { isMissingTableError, type StrategyDefinitionRow, type StrategyPlatformVersionRow } from "@/lib/strategy-platform/db";

/**
 * Creates a new USER_DEFINED strategy: one strategy_definitions row plus
 * its immutable first version (version_number = 1). Guests are refused
 * (mirrors every other mutation route in this app); ownership is also
 * enforced by RLS on both inserts regardless of anything checked here -
 * see supabase/migrations/20260917000000_strategy_platform.sql.
 *
 * A slug colliding with any BUILT_IN registry entry is refused before ever
 * reaching the database (spec Prompt 2 S22/S23: import/duplication can
 * never overwrite a built-in).
 */
const bodySchema = z.object({
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "slug must be lowercase letters, numbers, and hyphens only"),
  displayName: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  definition: z.record(z.string(), z.unknown()),
});

export async function POST(request: NextRequest) {
  const typedSupabase = await createClient();
  // strategy_definitions/strategy_platform_versions aren't in the generated
  // Database type yet (the migration adding them hasn't been applied to
  // this environment - see lib/strategy-platform/db.ts). Cast to `unknown`
  // for just these two calls rather than hand-editing the generated types
  // file; still the same RLS-respecting client, never the admin client.
  const supabase = typedSupabase as unknown as {
    auth: typeof typedSupabase.auth;
    from: (table: string) => { insert: (row: Record<string, unknown>) => { select: () => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } } };
  };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isOwner(user)) return NextResponse.json({ error: "Owner access required" }, { status: 403 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const { slug, displayName, description, definition } = parsed.data;

  const slugCheck = assertImportTargetSlugIsSafe(
    slug,
    BUILT_IN_STRATEGIES.map((s) => s.metadata.slug),
  );
  if (!slugCheck.ok) return NextResponse.json({ error: slugCheck.reason }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dslValidation = validateDslDefinition(definition as any);
  if (!dslValidation.ok) {
    return NextResponse.json({ error: "Invalid strategy definition", issues: dslValidation.errors }, { status: 400 });
  }

  const definitionInsert = await supabase
    .from("strategy_definitions")
    .insert({ slug, display_name: displayName, description: description ?? null, type: "USER_DEFINED", owner_user_id: user.id })
    .select()
    .single();

  if (definitionInsert.error) {
    if (isMissingTableError(definitionInsert.error)) {
      return NextResponse.json(
        { error: "Strategy platform tables are not yet available - the foundation migration has not been applied to this environment." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: definitionInsert.error.message }, { status: 400 });
  }

  const strategyDefinition = definitionInsert.data as StrategyDefinitionRow;

  const versionInsert = await supabase
    .from("strategy_platform_versions")
    .insert({
      strategy_definition_id: strategyDefinition.id,
      version_number: 1,
      version_label: "v1",
      engine_schema_version: "1",
      definition,
      status: "DRAFT",
      created_by: user.id,
    })
    .select()
    .single();

  if (versionInsert.error) {
    return NextResponse.json({ error: versionInsert.error.message }, { status: 400 });
  }

  return NextResponse.json({
    definition: strategyDefinition,
    version: versionInsert.data as StrategyPlatformVersionRow,
  });
}
