import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SystemStatusBadge, type SystemHealthLevel } from "@/components/dashboard/system-status-badge";
import { rowToNewsEvent } from "@/lib/news/store";
import type { NewsRisk } from "@/lib/news/types";
import { Newspaper } from "lucide-react";

export const dynamic = "force-dynamic";

function riskVariant(risk: NewsRisk): "default" | "secondary" | "outline" {
  if (risk === "HIGH") return "default";
  if (risk === "MEDIUM") return "secondary";
  return "outline";
}

/**
 * Read-only. News is context for the owner's judgement, never an input to
 * the deterministic engine.
 */
export default async function NewsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/news");

  const [{ data: eventRows }, { data: lastJob }] = await Promise.all([
    supabase.from("news_events").select("*").order("published_at", { ascending: false }).limit(50),
    supabase
      .from("job_runs")
      .select("started_at, status, records_processed, error_summary")
      .eq("job_name", "news")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const events = (eventRows ?? []).map(rowToNewsEvent);
  const ingestionLevel: SystemHealthLevel = !lastJob ? "UNKNOWN" : lastJob.status === "FAILED" ? "ERROR" : "HEALTHY";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">News</h1>
        <SystemStatusBadge level={ingestionLevel} label={lastJob ? `Feed ${ingestionLevel.toLowerCase()}` : "Feed unknown"} />
      </div>

      {events.length === 0 ? (
        <EmptyState icon={Newspaper} title="No recent news" />
      ) : (
        <div className="divide-border divide-y rounded-lg border">
          {events.map((event) => (
            <div key={event.id} className="flex items-start gap-4 px-4 py-3 text-sm">
              <span className="text-muted-foreground w-16 shrink-0 font-mono text-xs">
                {new Date(event.publishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              <div className="min-w-0 flex-1">
                <a href={event.canonicalUrl} target="_blank" rel="noopener noreferrer nofollow" className="hover:underline">
                  {event.headline}
                </a>
                <div className="text-muted-foreground mt-0.5 text-xs">{event.source}</div>
              </div>
              <Badge variant={riskVariant(event.newsRisk)} className="shrink-0">
                {event.newsRisk}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
