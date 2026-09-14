import { createClient } from "@/lib/supabase/server";
import { getQwenConfiguration, getTelegramConfiguration, getBybitDemoConfiguration } from "@/lib/config/integrations";
import { SystemStatusBadge, type SystemHealthLevel } from "@/components/dashboard/system-status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DataRow, Timestamp, relativeTimeShort } from "@/components/dashboard/primitives";
import { loadCurrentResearchWindow } from "@/lib/research/store";
import { loadResearchFunnel, loadResearchTrades } from "@/lib/research/evidence";
import { effectiveExecutionPolicy } from "@/lib/research/policy";
import { formatTimeRemaining, researchProgress, researchWindowState } from "@/lib/research/window";
import { evidenceLevel } from "@/lib/learning/analytics";
import { riskSettingsFromRow } from "@/lib/settings/risk-settings";
import { scannerHealthLevel } from "@/lib/health/scanner";

/** One integration row: status dot + label on the left, a short detail (only
 * when relevant) on the right. Full diagnostic text appears only on error. */
function StatusRow({
  label,
  level,
  detail,
  note,
}: {
  label: string;
  level: SystemHealthLevel;
  detail?: string;
  note?: string;
}) {
  return (
    <div className="border-b py-2.5 last:border-0">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <div className="flex items-center gap-2">
          {detail ? <span className="text-muted-foreground text-xs">{detail}</span> : null}
          <SystemStatusBadge level={level} />
        </div>
      </div>
      {note ? <p className="text-muted-foreground mt-1 text-xs">{note}</p> : null}
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
  const scannerNow = Date.now();
  const scannerLevel: SystemHealthLevel = scannerHealthLevel(
    lastRun ? { status: lastRun.status, startedAt: lastRun.started_at } : null,
    scannerNow,
  );

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
      <h1 className="text-xl font-semibold tracking-tight">System</h1>

      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Research</h2>
          <Badge variant={researchState === "ACTIVE" ? "default" : "secondary"}>
            {researchState === "ACTIVE" ? "ACTIVE" : researchState === "NOT_CONFIGURED" ? "NOT CONFIGURED" : researchState}
          </Badge>
        </div>
        <div className="mt-2 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          <DataRow label="Policy in force" value={researchPolicy.policy} />
          <DataRow label="Policy configured" value={researchSettings.executionPolicy} />
          <DataRow label="Trading mode" value={researchSettings.tradingMode} />
          <DataRow
            label="Time remaining"
            value={
              researchState === "ACTIVE" && researchProgressView
                ? `${formatTimeRemaining(researchProgressView.msRemaining)} · day ${researchProgressView.day}/${researchProgressView.totalDays}`
                : "-"
            }
          />
          <DataRow label="Candidates / risk-valid" value={researchFunnel ? `${researchFunnel.candidates} / ${researchFunnel.riskValidCandidates}` : "-"} />
          <DataRow label="Trades (closed)" value={researchWindow ? `${researchTrades.length} (${researchClosed})` : "-"} />
          <DataRow label="Evidence" value={evidenceLevel(researchClosed).replaceAll("_", " ")} />
        </div>
        {researchPolicy.degraded ? <p className="text-warning mt-3 text-xs">{researchPolicy.reason}</p> : null}
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-1 text-sm font-medium">Integrations</h2>
        <StatusRow label="Supabase" level="HEALTHY" />
        <StatusRow
          label="Market scanner"
          level={scannerLevel}
          detail={lastRun ? relativeTimeShort(lastRun.started_at, scannerNow) : undefined}
          note={scannerLevel === "ERROR" ? `Last run ${lastRun ? new Date(lastRun.started_at).toLocaleString() : "-"}` : undefined}
        />
        <StatusRow
          label="News ingestion"
          level={newsLevel}
          detail={newsJob ? relativeTimeShort(newsJob.started_at, scannerNow) : undefined}
          note={
            newsLevel === "ERROR" || newsLevel === "WARNING"
              ? `Last run ${newsJob ? new Date(newsJob.started_at).toLocaleString() : "-"}${newsJob?.error_summary ? ` · ${newsJob.error_summary}` : ""}`
              : undefined
          }
        />
        <StatusRow
          label="Qwen (AI coach)"
          level={qwenLevel}
          note={
            qwenLevel === "ERROR"
              ? `Last ${aiFailures.length} call(s) failed (${aiFailures[0]?.error_kind ?? "unknown"})`
              : qwenLevel === "WARNING" && !qwenConfig
                ? "Not configured"
                : undefined
          }
        />
        <StatusRow label="Telegram" level={telegramConfig ? "UNKNOWN" : "WARNING"} note={telegramConfig ? "Configured - use Settings to test" : "Not configured"} />
        <StatusRow label="Bybit Demo" level={demoConfig ? "HEALTHY" : "WARNING"} note={demoConfig ? undefined : "Not configured · informational, PAPER unaffected"} />
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="text-sm font-medium">AI usage</h2>
        {aiCalls.length === 0 ? (
          <p className="text-muted-foreground mt-2 text-sm">No calls recorded</p>
        ) : (
          <p className="mt-2 text-sm">
            {aiCalls.length} call{aiCalls.length === 1 ? "" : "s"} · {aiFailures.length} failed · {totalTokens.toLocaleString()} tokens
          </p>
        )}
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="mb-2 text-sm font-medium">Recent scans</h2>
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
                  <TableCell><Timestamp iso={run.started_at} /></TableCell>
                  <TableCell>{run.status}</TableCell>
                  <TableCell className="tabular-nums">{run.records_processed}</TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate text-xs">{run.error_summary ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-sm">No scans yet</p>
        )}
      </div>
    </div>
  );
}
