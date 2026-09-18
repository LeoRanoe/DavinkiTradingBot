import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth/authorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AssignmentRowControls } from "@/components/strategy-builder/assignment-row-controls";
import { isMissingTableError, type StrategyAssignmentRow, type StrategyConfigurationRow, type StrategyDefinitionRow, type StrategyPlatformVersionRow } from "@/lib/strategy-platform/db";

/**
 * Settings -> Strategies (Prompt 3 S15): every enabled/disabled assignment
 * for the signed-in user, with mode, markets, and priority - one screen to
 * answer "what do I have active, and where" (Prompt 3 S34).
 */
export default async function StrategiesSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isOwner(user)) redirect("/dashboard");

  const untyped = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, v: string) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
        in: (col: string, v: string[]) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };

  const assignmentsResult = await untyped.from("strategy_assignments").select("*").eq("user_id", user.id);
  if (assignmentsResult.error && isMissingTableError(assignmentsResult.error)) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Settings → Strategies</h1>
        <p className="text-muted-foreground text-sm">Strategy platform tables are not yet available - the foundation migration has not been applied to this environment.</p>
      </div>
    );
  }

  const assignments = (assignmentsResult.data ?? []) as StrategyAssignmentRow[];
  const configIds = [...new Set(assignments.map((a) => a.strategy_configuration_id))];
  const configs = configIds.length ? ((await untyped.from("strategy_configurations").select("*").in("id", configIds)).data as StrategyConfigurationRow[] | null) ?? [] : [];
  const versionIds = [...new Set(configs.map((c) => c.strategy_version_id))];
  const versions = versionIds.length ? ((await untyped.from("strategy_platform_versions").select("*").in("id", versionIds)).data as StrategyPlatformVersionRow[] | null) ?? [] : [];
  const definitionIds = [...new Set(versions.map((v) => v.strategy_definition_id))];
  const definitions = definitionIds.length ? ((await untyped.from("strategy_definitions").select("*").in("id", definitionIds)).data as StrategyDefinitionRow[] | null) ?? [] : [];

  const configById = new Map(configs.map((c) => [c.id, c]));
  const versionById = new Map(versions.map((v) => [v.id, v]));
  const definitionById = new Map(definitions.map((d) => [d.id, d]));

  const rows = assignments.map((a) => {
    const config = configById.get(a.strategy_configuration_id);
    const version = config ? versionById.get(config.strategy_version_id) : undefined;
    const definition = version ? definitionById.get(version.strategy_definition_id) : undefined;
    return { assignment: a, configName: config?.name ?? "-", strategyName: definition?.display_name ?? "-", versionLabel: version?.version_label ?? "-" };
  });

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings → Strategies</h1>
        <p className="text-muted-foreground text-sm">
          Your enabled strategy assignments. Switching to PAPER requires separate owner authorization; LIVE is disabled in this build and never offered here.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No strategy assignments yet - use &quot;Use this strategy&quot; on a strategy&apos;s detail page to create one.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Strategy</TableHead>
                    <TableHead>Configuration</TableHead>
                    <TableHead>Markets</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Mode / Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ assignment, configName, strategyName, versionLabel }) => (
                    <TableRow key={assignment.id}>
                      <TableCell>
                        {strategyName} <Badge variant="outline">{versionLabel}</Badge>
                      </TableCell>
                      <TableCell>{configName}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{assignment.instrument_ids.join(", ")}</TableCell>
                      <TableCell>{assignment.priority}</TableCell>
                      <TableCell>
                        <AssignmentRowControls assignmentId={assignment.id} enabled={assignment.enabled} mode={assignment.mode} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
