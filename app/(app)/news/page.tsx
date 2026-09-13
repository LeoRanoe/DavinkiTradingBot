import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { rowToNewsEvent } from "@/lib/news/store";
import type { NewsRisk } from "@/lib/news/types";

export const dynamic = "force-dynamic";

function riskVariant(risk: NewsRisk): "default" | "secondary" | "outline" {
  if (risk === "HIGH") return "default";
  if (risk === "MEDIUM") return "secondary";
  return "outline";
}

/**
 * News intelligence inspection surface.
 *
 * Read-only for everyone - there is deliberately no "act on this" control
 * anywhere on this page. News is context for the owner's judgement; it can
 * never authorise, size or block a trade.
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">News intelligence</h1>
        <p className="text-muted-foreground text-sm">
          Context only. Nothing here creates a trade, changes position size, moves a stop or target, or overrides a
          risk rejection - the deterministic engine never reads this data.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ingestion</CardTitle>
          <CardDescription>
            {lastJob
              ? `Last run ${new Date(lastJob.started_at).toLocaleString()} - ${lastJob.status}, ${lastJob.records_processed} new event(s).`
              : "The news ingestion job has not run yet."}
          </CardDescription>
        </CardHeader>
        {lastJob?.error_summary ? (
          <CardContent>
            <p className="text-muted-foreground text-xs">Provider issues: {lastJob.error_summary}</p>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent events</CardTitle>
          <CardDescription>
            Deduplicated across providers. Risk describes event uncertainty, never a buy or sell view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No news events stored yet. They appear once the ingestion job has run.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Published</TableHead>
                    <TableHead>Headline</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Quality</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Assets</TableHead>
                    <TableHead className="text-right">Relevance</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Analysis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {new Date(event.publishedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="max-w-sm">
                        <a
                          href={event.canonicalUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="hover:underline"
                        >
                          {event.headline}
                        </a>
                        {event.analysis ? (
                          <p className="text-muted-foreground mt-1 text-xs">{event.analysis.summary}</p>
                        ) : null}
                        {event.duplicateCount > 0 ? (
                          <p className="text-muted-foreground mt-1 text-xs">
                            +{event.duplicateCount} syndicated cop{event.duplicateCount === 1 ? "y" : "ies"}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs">{event.source}</TableCell>
                      <TableCell className="text-xs">{event.sourceQuality}</TableCell>
                      <TableCell className="text-xs">{event.category}</TableCell>
                      <TableCell className="text-xs">{event.affectedAssets.join(", ") || "-"}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {event.relevanceScore.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={riskVariant(event.newsRisk)}>{event.newsRisk}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">{event.analysisStatus}</TableCell>
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
