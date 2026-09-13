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

  const [{ data: jobRuns }, qwenConfig, telegramConfig, demoConfig] = await Promise.all([
    supabase.from("job_runs").select("*").eq("job_name", "scan").order("started_at", { ascending: false }).limit(10),
    getQwenConfiguration().catch(() => null),
    getTelegramConfiguration().catch(() => null),
    getBybitDemoConfiguration().catch(() => null),
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
            label="Qwen (AI coach)"
            level={qwenConfig ? "HEALTHY" : "WARNING"}
            detail={qwenConfig ? `Configured via ${qwenConfig.source}. Trading continues normally either way.` : "Not configured - explanations/lessons unavailable, trading unaffected."}
          />
          <Row
            label="Telegram"
            level={telegramConfig ? "HEALTHY" : "WARNING"}
            detail={telegramConfig ? `Configured via ${telegramConfig.source}.` : "Not configured - notifications unavailable, dashboard unaffected."}
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
