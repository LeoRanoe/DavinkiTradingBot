import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function StrategiesPage() {
  const supabase = await createClient();
  const { data: strategies } = await supabase.from("strategy_versions").select("*").order("created_at", { ascending: false });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Strategies</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {(strategies ?? []).map((s) => (
          <Card key={s.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">{s.name}</CardTitle>
              <Badge variant="outline">{s.status}</Badge>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-muted-foreground text-sm">{s.description}</p>
              <p className="text-muted-foreground text-xs">
                Version {s.version_label} · Created {new Date(s.created_at).toLocaleDateString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
