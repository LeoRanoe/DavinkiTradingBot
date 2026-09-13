import { createClient } from "@/lib/supabase/server";
import { getQwenConfiguration, getTelegramConfiguration, getBybitDemoConfiguration } from "@/lib/config/integrations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SystemStatusBadge, type SystemHealthLevel } from "@/components/dashboard/system-status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
