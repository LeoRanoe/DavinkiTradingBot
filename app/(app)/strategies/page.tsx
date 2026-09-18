import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listUserStrategyDefinitions, isMissingTableError, type StrategyDefinitionRow } from "@/lib/strategy-platform/db";
import { listBuiltInStrategies } from "@/lib/strategy-platform/registry";
import { Plus } from "lucide-react";

const FEATURED_SLUG = "jeanfx-v1";

/**
 * /strategies: built-in strategies (from the registry, no DB dependency -
 * always available) plus the signed-in user's own USER_DEFINED strategies
 * (from strategy_definitions; gracefully empty if that migration hasn't
 * been applied to this environment yet - see lib/strategy-platform/db.ts).
 * Multiple strategies can be active side by side; nothing here implies
 * only one may exist (spec Prompt 2 S17).
 */
export default async function StrategiesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const builtIns = listBuiltInStrategies();

  let customStrategies: StrategyDefinitionRow[] = [];
  let platformUnavailable = false;
  if (user) {
    const { data, error } = await listUserStrategyDefinitions(supabase, user.id);
    if (error && isMissingTableError(error)) platformUnavailable = true;
    else customStrategies = data ?? [];
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Strategies</h1>
          <p className="text-muted-foreground text-sm">Built-in strategies and your custom strategies. Select one or more to run in RESEARCH.</p>
        </div>
        <Button
          render={
            <Link href="/strategies/new">
              <Plus className="size-4" /> Create Strategy
            </Link>
          }
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide uppercase">Built-in</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {builtIns.map((s) => (
            <Link key={s.metadata.slug} href={`/strategies/${s.metadata.slug}`}>
              <Card className="hover:bg-accent/50 h-full transition-colors">
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      {s.metadata.displayName}
                      {s.metadata.slug === FEATURED_SLUG && <Badge>Featured</Badge>}
                    </CardTitle>
                    <CardDescription className="mt-1">{s.metadata.description}</CardDescription>
                  </div>
                  <Badge variant="outline">{s.metadata.status}</Badge>
                </CardHeader>
                <CardContent className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <span>Markets: {s.metadata.supportedAssetClasses.join(", ")}</span>
                  <span>Timeframes: {s.metadata.requiredTimeframes.join("/")}</span>
                  <span>Sides: {s.metadata.supportedSides.join(", ")}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide uppercase">My Strategies</h2>
        {platformUnavailable && (
          <p className="text-muted-foreground text-sm">
            Custom strategy storage is not yet available in this environment - the strategy platform migration has not been applied.
          </p>
        )}
        {!platformUnavailable && customStrategies.length === 0 && (
          <p className="text-muted-foreground text-sm">
            You haven&apos;t created a custom strategy yet.{" "}
            <Link href="/strategies/new" className="underline underline-offset-2">
              Create one
            </Link>
            .
          </p>
        )}
        {customStrategies.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
            {customStrategies.map((s) => (
              <Link key={s.id} href={`/strategies/${s.slug}`}>
                <Card className="hover:bg-accent/50 h-full transition-colors">
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">{s.display_name}</CardTitle>
                    <Badge variant="outline">USER_DEFINED</Badge>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground text-sm">{s.description}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
