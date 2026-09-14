import { createClient } from "@/lib/supabase/server";
import { getQwenConfiguration, getTelegramConfiguration, getBybitDemoConfiguration } from "@/lib/config/integrations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SystemStatusBadge, type SystemHealthLevel } from "@/components/dashboard/system-status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { loadCurrentResearchWindow } from "@/lib/research/store";
import { loadResearchFunnel, loadResearchTrades } from "@/lib/research/evidence";
import { effectiveExecutionPolicy } from "@/lib/research/policy";
import { formatTimeRemaining, researchProgress, researchWindowState } from "@/lib/research/window";
import { evidenceLevel } from "@/lib/learning/analytics";
import { riskSettingsFromRow } from "@/lib/settings/risk-settings";

function Row({ label, level, detail }: { label: string; level: SystemHealthLevel; detail: string }) {
  return (
    <div className="flex items-center justify-between border-b py-3 last:border-0">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-muted-foreground text-xs">{detail}</div>
      </div>
      <SystemStatusBadge level={level} />
    </div>
  );
}

export default async function SystemPage() {
  const supabase = await createClient();

  const [{ data: jobRuns }, qwenConfig, telegramConfig, demoConfig, { data: newsJob }, { data: aiUsage }] =
    await Promise.all([
      supabase.from("job_runs").select("*").eq("job_name", "scan").order("started_at", { ascending: false }).limit(10),
      getQwenConfiguration().catch(() => null),
      getTelegramConfiguration().catch(() => null),
      getBybitDemoConfiguration().catch(() => null),
      supabase
        .from("job_runs")
        .select("started_at, status, records_processed, error_summary")
        .eq("job_name", "news")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("ai_usage_events")
        .select("feature, success, total_tokens, created_at, error_kind")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  // Research diagnostics. Reported from persisted state only - an unreadable
  // window is shown as NOT CONFIGURED rather than assumed healthy.
  const researchWindow = await loadCurrentResearchWindow(supabase).catch(() => null);
  const { data: settingsRow } = await supabase.from("system_settings").select("*").eq("id", true).maybeSingle();
  const researchSettings = riskSettingsFromRow(settingsRow);
  // Server Component: evaluated once per request, deliberately - diagnostics
  // must report the window's state now, not a cached one.
  // eslint-disable-next-line react-hooks/purity
  const researchNow = Date.now();
  const researchState = researchWindowState(researchWindow, researchNow);
  const researchPolicy = effectiveExecutionPolicy({
    configuredPolicy: researchSettings.executionPolicy,
    tradingMode: researchSettings.tradingMode,
    researchWindow,
    now: researchNow,
  });
  const researchProgressView = researchWindow ? researchProgress(researchWindow, researchNow) : null;
  const researchTrades = researchWindow
    ? await loadResearchTrades(supabase, researchWindow.id).catch(() => [])
    : [];
  const researchFunnel = researchWindow
    ? await loadResearchFunnel(supabase, researchWindow.id).catch(() => null)
    : null;
  const researchClosed = researchTrades.filter((t) => t.closedAt !== null).length;

  const lastRun = jobRuns?.[0];
  // Server Component: this value is intentionally evaluated once per request
  // so the health badge can detect a scheduler that has stopped advancing.
  // eslint-disable-next-line react-hooks/purity
  const lastRunAgeMs = lastRun ? Date.now() - new Date(lastRun.started_at).getTime() : null;
  const scannerLevel: SystemHealthLevel = !lastRun
    ? "UNKNOWN"
    : lastRun.status === "FAILED" || (lastRunAgeMs !== null && lastRunAgeMs > 12 * 60_000)
      ? "ERROR"
      : lastRunAgeMs !== null && lastRunAgeMs > 7 * 60_000
        ? "WARNING"
        : lastRun.status === "SUCCEEDED" || lastRun.status === "NOOP"
          ? "HEALTHY"
          : "WARNING";

  // News ingestion health. Deliberately NOT "healthy because a feed URL is
  // configured": it reflects whether the job actually ran and what happened.
  // eslint-disable-next-line react-hooks/purity
  const newsAgeMs = newsJob ? Date.now() - new Date(newsJob.started_at).getTime() : null;
  const newsLevel: SystemHealthLevel = !newsJob
    ? "UNKNOWN"
    : newsJob.status === "FAILED"
      ? "ERROR"
      : newsAgeMs !== null && newsAgeMs > 60 * 60_000
        ? "WARNING"
        : newsJob.error_summary
          ? "WARNING"
          : "HEALTHY";

  const aiCalls = aiUsage ?? [];
  const aiFailures = aiCalls.filter((u) => !u.success);
  const lastAiSuccess = aiCalls.find((u) => u.success);
  const totalTokens = aiCalls.reduce((sum, u) => sum + (u.total_tokens ?? 0), 0);

  // Qwen health is evidence-based: a configured credential alone proves
  // nothing, a recent successful call does.
  const qwenLevel: SystemHealthLevel = !qwenConfig
    ? "WARNING"
    : lastAiSuccess
      ? "HEALTHY"
      : aiFailures.length > 0
        ? "ERROR"
        : "UNKNOWN";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">System</h1>
        <p className="text-muted-foreground text-sm">Operational status of every integration. No secrets are ever shown here.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Paper research</CardTitle>
            <Badge variant={researchState === "ACTIVE" ? "default" : "secondary"}>
              {researchState === "ACTIVE"
                ? "ACTIVE"
                : researchState === "NOT_CONFIGURED"
                  ? "NOT CONFIGURED"
                  : researchState}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-xs">Execution policy (in force)</dt>
              <dd className="font-medium">{researchPolicy.policy}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Execution policy (configured)</dt>
              <dd className="font-medium">{researchSettings.executionPolicy}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Trading mode</dt>
              <dd className="font-medium">{researchSettings.tradingMode}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Research start</dt>
              <dd className="font-mono text-xs">{researchWindow?.startedAt ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Research end</dt>
              <dd className="font-mono text-xs">{researchWindow?.endsAt ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Time remaining</dt>
              <dd className="font-medium">
                {researchState === "ACTIVE" && researchProgressView
                  ? `${formatTimeRemaining(researchProgressView.msRemaining)} (day ${researchProgressView.day} of ${researchProgressView.totalDays})`
                  : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Candidates / risk-valid</dt>
              <dd className="font-medium">
                {researchFunnel ? `${researchFunnel.candidates} / ${researchFunnel.riskValidCandidates}` : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Trades collected (closed)</dt>
              <dd className="font-medium">
                {researchWindow ? `${researchTrades.length} (${researchClosed})` : "-"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Evidence level</dt>
              <dd className="font-medium">{evidenceLevel(researchClosed)}</dd>
            </div>
          </dl>
          {researchPolicy.degraded ? (
            <p className="mt-4 text-sm text-amber-600 dark:text-amber-500">{researchPolicy.reason}</p>
          ) : (
            <p className="text-muted-foreground mt-4 text-xs">{researchPolicy.reason}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Integrations</CardTitle>
        </CardHeader>
        <CardContent className="divide-border divide-y">
          <Row
            label="Supabase"
            level="HEALTHY"
            detail="Database connection used to render this page succeeded."
          />
          <Row
            label="Market scanner"
            level={scannerLevel}
            detail={lastRun ? `Last run: ${new Date(lastRun.started_at).toLocaleString()} - ${lastRun.status}` : "Has not run yet."}
          />
          <Row
            label="News ingestion"
            level={newsLevel}
            detail={
              newsJob
                ? `Last run: ${new Date(newsJob.started_at).toLocaleString()} - ${newsJob.status}, ${newsJob.records_processed} new event(s).${newsJob.error_summary ? ` Provider issues: ${newsJob.error_summary}` : ""}`
                : "Has not run yet. Trading is unaffected either way."
            }
          />
          <Row
            label="Qwen (AI coach)"
            level={qwenLevel}
            detail={
              !qwenConfig
                ? "Not configured - news analysis, explanations and lessons unavailable. Trading unaffected."
                : lastAiSuccess
                  ? `Configured via ${qwenConfig.source}; model ${qwenConfig.model}. Last successful call ${new Date(lastAiSuccess.created_at).toLocaleString()}.`
                  : aiFailures.length > 0
                    ? `Configured via ${qwenConfig.source}, but the last ${aiFailures.length} call(s) failed (${aiFailures[0].error_kind ?? "unknown"}). Trading is unaffected.`
                    : `Configured via ${qwenConfig.source}; no call has been made yet, so health is unproven.`
            }
          />
          <Row
            label="Telegram"
            level={telegramConfig ? "UNKNOWN" : "WARNING"}
            detail={telegramConfig ? `Configured via ${telegramConfig.source}; use Settings → Test connection for a live outbound check.` : "Not configured - notifications unavailable, dashboard unaffected."}
          />
          <Row
            label="Bybit Demo"
            level={demoConfig ? "HEALTHY" : "WARNING"}
            detail={demoConfig ? `Configured via ${demoConfig.source}.` : "Not configured - Demo execution unavailable, paper trading unaffected."}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI usage (last 50 calls)</CardTitle>
        </CardHeader>
        <CardContent>
          {aiCalls.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No AI calls recorded. Routine scans and ingestion runs are expected to make none.
            </p>
          ) : (
            <div className="text-sm">
              <p>
                {aiCalls.length} call(s), {aiFailures.length} failed, {totalTokens.toLocaleString()} tokens total.
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Token counts only - no monetary cost is shown, because reliable per-token pricing for the configured
                model is not known to this application.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent scan runs</CardTitle>
        </CardHeader>
        <CardContent>
          {jobRuns && jobRuns.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Processed</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono text-xs">{new Date(run.started_at).toLocaleString()}</TableCell>
                    <TableCell>{run.status}</TableCell>
                    <TableCell>{run.records_processed}</TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate text-xs">{run.error_summary ?? "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-sm">No scan runs recorded yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
