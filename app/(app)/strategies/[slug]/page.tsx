import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getBuiltInStrategy } from "@/lib/strategy-platform/registry";
import { listStrategyVersions, listConfigurationsForVersion, isMissingTableError, type StrategyPlatformVersionRow } from "@/lib/strategy-platform/db";
import { describeDslDefinition } from "@/lib/strategy-platform/dsl/describe";
import { validateDslDefinition } from "@/lib/strategy-platform/dsl/validate";
import { UseStrategyForm } from "@/components/strategy-builder/use-strategy-form";
import type { DslDefinition } from "@/lib/strategy-platform/dsl/types";

export default async function StrategyDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const builtIn = getBuiltInStrategy(slug);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // strategy_definitions carries both built-in (seeded) and custom rows -
  // one lookup by slug covers both cases identically. Cast for the same
  // reason as lib/strategy-platform/db.ts: this table isn't in the
  // generated Database type until its migration is applied.
  const untypedSupabase = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => { eq: (col: string, v: string) => { maybeSingle: () => Promise<{ data: { id: string; display_name: string; description: string | null; type: string } | null; error: { message: string } | null }> } };
    };
  };
  const definitionQuery = await untypedSupabase.from("strategy_definitions").select("id, display_name, description, type").eq("slug", slug).maybeSingle();

  if (!builtIn && !definitionQuery.data) {
    if (definitionQuery.error && isMissingTableError(definitionQuery.error)) {
      // Platform tables not applied yet - built-ins still render from the registry above.
    } else {
      notFound();
    }
  }

  const displayName = builtIn?.metadata.displayName ?? definitionQuery.data?.display_name ?? slug;
  const description = builtIn?.metadata.description ?? definitionQuery.data?.description ?? "";

  let versions: StrategyPlatformVersionRow[] = [];
  if (definitionQuery.data) {
    const { data } = await listStrategyVersions(supabase, definitionQuery.data.id);
    versions = data ?? [];
  }

  const latestVersion = versions[0] ?? null;
  let latestDefinitionDsl: DslDefinition | null = null;
  if (latestVersion && !(latestVersion.definition as { builtIn?: boolean } | null)?.builtIn) {
    latestDefinitionDsl = latestVersion.definition as DslDefinition;
  }

  let configurationCount = 0;
  if (latestVersion && user) {
    const { data } = await listConfigurationsForVersion(supabase, latestVersion.id, user.id);
    configurationCount = data?.length ?? 0;
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/strategies" className="text-muted-foreground text-sm underline underline-offset-2">
          Strategies
        </Link>
        <span className="text-muted-foreground text-sm">/</span>
        <h1 className="text-xl font-semibold tracking-tight">{displayName}</h1>
        {builtIn && <Badge variant="outline">{builtIn.metadata.type}</Badge>}
        {builtIn && <Badge>{builtIn.metadata.status}</Badge>}
      </div>
      <p className="text-muted-foreground text-sm">{description}</p>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="use">Use this strategy</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {builtIn ? (
                <>
                  <p>Markets: {builtIn.metadata.supportedAssetClasses.join(", ")}</p>
                  <p>Timeframes: {builtIn.metadata.requiredTimeframes.join("/")}</p>
                  <p>Sides: {builtIn.metadata.supportedSides.join(", ")}</p>
                  <p>Configurations you&apos;ve created: {configurationCount}</p>
                </>
              ) : (
                <p>Configurations you&apos;ve created: {configurationCount}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rules</CardTitle>
            </CardHeader>
            <CardContent>
              {latestDefinitionDsl ? (
                <>
                  <pre className="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap">{describeDslDefinition(latestDefinitionDsl)}</pre>
                  <p className="text-muted-foreground mt-2 text-xs">
                    {validateDslDefinition(latestDefinitionDsl).ok ? "This version's rules validate cleanly." : "Warning: this version's rules no longer validate against the current DSL."}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  This is a built-in strategy - its logic lives in code (lib/strategy-platform/built-in/), not a DSL definition. See{" "}
                  {slug === "jeanfx-v1" ? (
                    <code>docs/strategies/jeanfx-v1-spec.md</code>
                  ) : slug === "v1" ? (
                    <code>docs/STRATEGY_V1.md</code>
                  ) : (
                    "the registry entry"
                  )}{" "}
                  for the full rule set.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="versions">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Versions</CardTitle>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No versions found - the strategy platform migration may not be applied yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between border-b pb-2 last:border-0">
                      <span>
                        {v.version_label} (#{v.version_number})
                      </span>
                      <Badge variant="outline">{v.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted-foreground mt-2 text-xs">
                Versions are immutable - editing rules always creates a new version, never overwrites this one.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="use">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Use this strategy</CardTitle>
            </CardHeader>
            <CardContent>
              {!user ? (
                <p className="text-muted-foreground text-sm">Sign in to configure and assign this strategy.</p>
              ) : !latestVersion ? (
                <p className="text-muted-foreground text-sm">No version available yet to assign.</p>
              ) : (
                <UseStrategyForm strategyVersionId={latestVersion.id} defaultName={`${displayName} - default`} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
